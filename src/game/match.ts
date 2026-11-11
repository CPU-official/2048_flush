import { createGame, maxTile, move, type Direction, type GameState, type MoveResult } from '../core/game';
import type { ClientMessage, GameOverReason, MatchOutcome, ResultReason, ServerMessage } from '../net/messages';
import { GameSession } from './session';

// 1대1 대결의 클라이언트 쪽 흐름 (docs/overview-project.md "대결 화면", docs/networking.md "대결 진행 흐름").
// 화면, 시계, 네트워크를 모른다: 시계(ms)는 호출하는 쪽이 넘기고, 서버로는 post만 쓴다.
export type Phase = 'idle' | 'waiting' | 'countdown' | 'playing' | 'finished';

export interface MatchResult {
  outcome: MatchOutcome;
  score: number;
  opponentScore: number;
  reason: ResultReason;
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
  // 상대 입력이 보드에 반영될 때, 화면이 연출을 붙이도록 불린다
  onOpponentMove = (_result: MoveResult): void => {};
  // phase나 종료 상태가 바뀔 때 불린다
  onChange = (): void => {};
  private startAt = 0;
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

  // 접속이 끊겼다. 대기 중이면 서버도 대기열에서 뺐으니 처음으로 돌아간다. 진행 중인 대결은 재접속으로 이어간다 (7-E).
  disconnected(): void {
    if (this.phase === 'waiting') this.leave();
  }

  // 남은 대결 시간(초). 카운트다운 중에는 상한 전체.
  remaining(now: number): number {
    return Math.min(this.timeLimit, this.timeLimit - (now - this.startAt) / 1000);
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
    } else if (msg.type === 'start') {
      this.startAt = now + msg.startIn;
      this.timeLimit = msg.timeLimit;
      this.mine = new GameSession(msg.seed, msg.timer, this.startAt); // 시간 바는 시작 시각부터 줄어든다
      this.theirs = createGame(msg.seed);
      this.phase = 'countdown';
      this.onChange();
    } else if (msg.type === 'move') {
      // TCP라 순서는 보장된다. 이미 반영한 턴이 다시 오면 무시한다.
      if (!this.theirs || msg.turn < this.opponentTurns) return;
      const result = move(this.theirs, msg.dir);
      this.opponentTurns = msg.turn + 1;
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
    if (this.phase === 'countdown' && now >= this.startAt) {
      this.phase = 'playing';
      this.onChange();
    }
    if (this.phase === 'playing' && this.mine?.tick(now)) this.report(this.mine.ended!);
  }

  // 내 입력. 카운트다운 중이거나 내 게임이 끝났으면 null.
  input(dir: Direction, now: number): MoveResult | null {
    if (this.phase !== 'playing' || !this.mine || this.myEnd) return null;
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

  private reset(): void {
    this.phase = 'idle';
    this.opponent = '';
    this.mine = null;
    this.theirs = null;
    this.opponentOver = null;
    this.result = null;
    this.timeLimit = 0;
    this.startAt = 0;
    this.opponentTurns = 0;
    this.myEnd = null;
  }
}
