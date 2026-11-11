import { createGame, maxTile, move, type Direction, type GameState, type MoveResult } from '../core/game';
import { RECONNECT_WAIT } from '../constants';
import type { ClientMessage, GameOverReason, MatchOutcome, MatchRestore, ResultReason, ServerMessage } from '../net/messages';
import { GameSession } from './session';
import { timeLimit, type TimerSettings } from './timer';

// 1대1 대결의 클라이언트 쪽 흐름 (docs/overview-project.md "대결 화면", docs/networking.md "대결 진행 흐름").
// 화면, 시계, 네트워크를 모른다: 시계(ms)는 호출하는 쪽이 넘기고, 서버로는 post만 쓴다.
export type Phase = 'idle' | 'waiting' | 'countdown' | 'playing' | 'finished';

export interface MatchResult {
  outcome: MatchOutcome;
  score: number;
  opponentScore: number;
  reason: ResultReason;
}

// 점수 차이는 앞선 쪽을 가리킨다 (내가 왼쪽, 상대가 오른쪽): "◀ +320" / "+320 ▶"
export function diffText(me: number, opponent: number): string {
  if (me === opponent) return '0';
  return me > opponent ? `◀ +${me - opponent}` : `+${opponent - me} ▶`;
}

export class Match {
  phase: Phase = 'idle';
  opponent = ''; // 상대 닉네임
  mine: GameSession | null = null;
  theirs: GameState | null = null; // 서버가 중계한 입력을 core로 재생한 상대 보드
  myEnd: GameOverReason | null = null; // 내 게임이 끝났고 서버에 알렸다 (stuck, timeout, matchTime)
  opponentOver: { score: number; reason: GameOverReason } | null = null;
  result: MatchResult | null = null;
  timeLimit = 0; // 대결 시간 상한(초)
  offline = false; // 내 연결이 끊겨 재접속을 기다리는 중 (게임은 멈춘다)
  opponentOffline = false; // 상대가 끊겼다
  lost = false; // 재접속하지 못해 대결을 잃었다 (화면은 시작 화면으로 돌아간다)
  // 상대 입력이 보드에 반영될 때, 화면이 연출을 붙이도록 불린다
  onOpponentMove = (_result: MoveResult): void => {};
  // 재접속으로 두 보드를 로그에서 다시 만들었다 (화면이 보드를 맞춘다)
  onRestore = (): void => {};
  // phase나 종료 상태가 바뀔 때 불린다
  onChange = (): void => {};
  private id = '';
  private slot: 0 | 1 = 0;
  private offlineAt = 0;
  private resumeSent = false;
  private startAt = 0;
  private timer: TimerSettings | null = null;
  private opponentMoveAt = 0; // 상대의 마지막 입력을 받은 시각 (상대 시간 바를 짐작하는 데 쓴다)
  private opponentTurns = 0;

  constructor(private net: { post(msg: ClientMessage): boolean }) {}

  // 대기열에 들어간다. 서버에 닿지 못하면 false.
  find(nickname: string): boolean {
    if (this.phase !== 'idle' && this.phase !== 'finished') return false;
    this.reset();
    if (!this.net.post({ type: 'match.find', nickname })) return false;
    this.phase = 'waiting';
    this.onChange();
    return true;
  }

  // 대기 취소 또는 결과 화면에서 나가기. 카운트다운/진행 중에는 서버의 대결이 남으므로 무시한다.
  leave(): void {
    if (this.phase === 'countdown' || this.phase === 'playing') return;
    if (this.phase === 'waiting') this.net.post({ type: 'match.cancel' });
    this.reset();
    this.onChange();
  }

  // 접속이 끊겼다. 대기 중이면 서버도 대기열에서 뺐으니 처음으로 돌아간다. 진행 중인 대결은 재접속으로 이어간다.
  disconnected(now: number): void {
    if (this.phase === 'waiting') this.leave();
    if (this.phase !== 'countdown' && this.phase !== 'playing') return;
    this.resumeSent = false; // resume 응답 전에 또 끊겨도 다음 접속에서 다시 보낸다
    if (!this.offline) {
      this.offline = true;
      this.offlineAt = now;
      this.onChange();
    }
  }

  // 다시 접속됐다. 끊겨 있던 대결이 있으면 자리를 되찾는다 (서버가 match.restore로 로그를 돌려준다).
  connected(): void {
    if (!this.offline || this.resumeSent) return;
    this.resumeSent = this.net.post({ type: 'match.resume', id: this.id, slot: this.slot });
  }

  // 남은 대결 시간(초). 카운트다운 중에는 상한 전체.
  remaining(now: number): number {
    return Math.min(this.timeLimit, this.timeLimit - (now - this.startAt) / 1000);
  }

  // 상대의 이번 수 남은 시간 비율 0~1. 상대 화면의 실제 타이머가 아니라, 입력이 도착한 시각으로 짐작한 값이다.
  opponentTime(now: number): number {
    if (!this.theirs || !this.timer || this.opponentOver) return this.opponentOver ? 0 : 1;
    const limit = timeLimit(this.theirs.moves, this.timer);
    const since = Math.max(0, now - Math.max(this.startAt, this.opponentMoveAt)) / 1000;
    return Math.min(1, Math.max(0, (limit - since) / limit));
  }

  // 카운트다운 남은 시간(초)
  countdown(now: number): number {
    return Math.max(0, (this.startAt - now) / 1000);
  }

  // 서버 메시지를 처리한다
  handle(msg: ServerMessage, now: number): void {
    if (this.phase === 'idle' || this.phase === 'finished') return;
    if (this.phase === 'waiting' && msg.type !== 'match.found' && msg.type !== 'start') return; // 대기 중에는 이전 대결의 늦은 메시지를 무시한다
    if (msg.type === 'match.found') {
      this.opponent = msg.opponent;
      this.id = msg.id;
      this.slot = msg.slot;
    } else if (msg.type === 'opponent.status') {
      this.opponentOffline = msg.status === 'offline';
      this.onChange();
    } else if (msg.type === 'match.restore') {
      if (this.offline && msg.restore.id === this.id) this.restore(msg.restore, now);
    } else if (msg.type === 'start') {
      this.startAt = now + msg.startIn;
      this.timeLimit = msg.timeLimit;
      this.timer = msg.timer;
      this.mine = new GameSession(msg.seed, msg.timer, this.startAt); // 시간 바는 시작 시각부터 줄어든다
      this.theirs = createGame(msg.seed);
      this.phase = 'countdown';
      this.onChange();
    } else if (msg.type === 'move') {
      // TCP라 순서는 보장된다. 이미 반영한 턴이 다시 오면 무시한다.
      if (!this.theirs || msg.turn < this.opponentTurns) return;
      const result = move(this.theirs, msg.dir);
      this.opponentTurns = msg.turn + 1;
      this.opponentMoveAt = now;
      if (!result.moved) return;
      this.theirs = result.state;
      this.onOpponentMove(result);
    } else if (msg.type === 'match.timeup') {
      if (this.phase === 'playing') this.report('matchTime');
    } else if (msg.type === 'opponent.over') {
      this.opponentOver = { score: msg.score, reason: msg.reason };
      this.onChange();
    } else if (msg.type === 'result') {
      this.result = { outcome: msg.outcome, score: msg.score, opponentScore: msg.opponentScore, reason: msg.reason };
      this.phase = 'finished';
      this.onChange();
    }
  }

  // 매 프레임: 카운트다운이 끝나면 시작하고, 내 시간이 다 되면 끝낸다.
  tick(now: number): void {
    if (this.offline) {
      // 서버도 이 시간이 지나면 부전승으로 끝낸다 (끝난 대결의 resume은 서버가 무시한다). 내 게임이 이미 끝났으면 서버가 기다리지 않으니 우리도 포기하지 않는다.
      if (!this.myEnd && now - this.offlineAt > RECONNECT_WAIT * 1000) {
        this.reset();
        this.lost = true;
        this.onChange();
      }
      return;
    }
    if (this.phase === 'countdown' && now >= this.startAt) {
      this.phase = 'playing';
      this.onChange();
    }
    if (this.phase === 'playing' && this.mine?.tick(now)) this.report(this.mine.ended!);
  }

  // 내 입력. 카운트다운 중이거나 내 게임이 끝났으면 null.
  input(dir: Direction, now: number): MoveResult | null {
    if (this.phase !== 'playing' || !this.mine || this.myEnd || this.offline) return null;
    const result = this.mine.input(dir, now);
    if (result) {
      this.net.post({ type: 'move', dir, turn: this.mine.state.moves - 1 });
      if (this.mine.ended) this.report(this.mine.ended);
    } else if (this.mine.ended) {
      this.report(this.mine.ended); // 입력 직전에 시간이 다 된 경우
    }
    return result;
  }

  // 내 게임이 끝났다고 서버에 한 번만 알린다
  private report(reason: GameOverReason): void {
    if (this.myEnd || !this.mine) return;
    this.myEnd = reason;
    this.net.post({ type: 'gameover', score: this.mine.state.score, maxTile: maxTile(this.mine.state.board), reason });
    this.onChange();
  }

  // 서버가 보관한 두 입력 로그로 두 보드를 다시 만든다. 내 수의 남은 시간은 복귀한 시각부터 새로 센다.
  private restore(r: MatchRestore, now: number): void {
    this.startAt = now + r.startIn;
    this.timeLimit = r.timeLimit;
    this.timer = r.timer;
    this.mine = new GameSession(r.seed, r.timer, Math.max(now, this.startAt));
    for (const dir of r.mine.moves) this.mine.input(dir, now);
    this.theirs = createGame(r.seed);
    for (const dir of r.theirs.moves) {
      const result = move(this.theirs, dir);
      if (result.moved) this.theirs = result.state;
    }
    this.opponentTurns = r.theirs.moves.length;
    this.opponentMoveAt = now;
    this.opponentOver = r.theirs.over;
    this.myEnd = r.mine.over?.reason ?? null;
    this.offline = false;
    this.phase = r.startIn > 0 ? 'countdown' : 'playing';
    this.onRestore();
    this.onChange();
    if (!this.myEnd) {
      if (r.timeUp) this.report('matchTime');
      else if (this.mine.ended) this.report(this.mine.ended);
    }
  }

  private reset(): void {
    this.offline = false;
    this.opponentOffline = false;
    this.lost = false;
    this.id = '';
    this.resumeSent = false;
    this.phase = 'idle';
    this.opponent = '';
    this.mine = null;
    this.theirs = null;
    this.opponentOver = null;
    this.result = null;
    this.timeLimit = 0;
    this.startAt = 0;
    this.timer = null;
    this.opponentMoveAt = 0;
    this.opponentTurns = 0;
    this.myEnd = null;
  }
}
