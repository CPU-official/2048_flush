import { MATCH_COUNTDOWN, MATCH_TIME_LIMIT, NICKNAME_MAX } from '../../src/constants';
import type { Direction } from '../../src/core/game';
import type { TimerSettings } from '../../src/game/timer';
import type { ClientMessage, GameOverReason, MatchOutcome, ServerMessage } from '../../src/net/messages';

// 1대1 대결 매칭/중계/판정. ws, 시계, 난수를 모르는 순수 로직이라 가짜 환경으로 테스트한다 (docs/networking.md "대결 진행 흐름").
export interface MatchEnv {
  send(player: number, msg: ServerMessage): void;
  timer(): TimerSettings;
  random(): number; // 0 이상 1 미만
  after(ms: number, fn: () => void): () => void; // 예약. 돌려주는 함수로 취소
}

interface Over {
  score: number;
  maxTile: number;
  reason: GameOverReason;
}
interface Side {
  id: number;
  nickname: string;
  moves: { dir: Direction; turn: number }[]; // 재접속 복원용 입력 로그
  over: Over | null;
}
interface Match {
  id: string;
  sides: [Side, Side];
  timeUp: boolean;
  cancel: () => void;
}

const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const REASONS = new Set(['stuck', 'timeout', 'matchTime']);

export function createMatches(env: MatchEnv) {
  const waiting: { id: number; nickname: string }[] = [];
  const matches = new Map<number, Match>(); // 연결 id → 그 사람의 대결
  let counter = 0;

  const leaveQueue = (player: number) => {
    const i = waiting.findIndex((w) => w.id === player);
    if (i >= 0) waiting.splice(i, 1);
  };
  const opponentOf = (match: Match, id: number) => (match.sides[0].id === id ? match.sides[1] : match.sides[0]);
  const sideOf = (match: Match, id: number) => (match.sides[0].id === id ? match.sides[0] : match.sides[1]);

  function finish(match: Match): void {
    match.cancel();
    const [a, b] = match.sides;
    for (const s of match.sides) matches.delete(s.id);
    const reason = match.timeUp ? 'timeLimit' : 'normal';
    const outcome = (mine: number, theirs: number): MatchOutcome => (mine > theirs ? 'win' : mine < theirs ? 'lose' : 'draw');
    const [sa, sb] = [a.over!.score, b.over!.score];
    env.send(a.id, { type: 'result', outcome: outcome(sa, sb), score: sa, opponentScore: sb, reason });
    env.send(b.id, { type: 'result', outcome: outcome(sb, sa), score: sb, opponentScore: sa, reason });
  }

  function create(first: { id: number; nickname: string }, second: { id: number; nickname: string }): void {
    const sides: [Side, Side] = [
      { ...first, moves: [], over: null },
      { ...second, moves: [], over: null },
    ];
    const match: Match = { id: String(++counter), sides, timeUp: false, cancel: () => {} };
    for (const s of sides) matches.set(s.id, match);
    const seed = Math.floor(env.random() * 2 ** 32) | 0;
    const timer = env.timer();
    sides.forEach((s, slot) => {
      env.send(s.id, { type: 'match.found', id: match.id, opponent: sides[1 - slot].nickname, slot: slot as 0 | 1 });
      env.send(s.id, { type: 'start', id: match.id, seed, startIn: MATCH_COUNTDOWN * 1000, timer, timeLimit: MATCH_TIME_LIMIT });
    });
    // 대결 시간 상한은 카운트다운이 끝나 게임이 시작된 때부터 센다
    match.cancel = env.after((MATCH_COUNTDOWN + MATCH_TIME_LIMIT) * 1000, () => {
      match.timeUp = true;
      for (const s of sides) env.send(s.id, { type: 'match.timeup' });
    });
  }

  return {
    // 클라이언트가 보낸 대결 메시지를 처리한다. 잘못된 메시지는 무시한다.
    handle(player: number, msg: ClientMessage): void {
      if (msg.type === 'match.find') {
        const nickname = typeof msg.nickname === 'string' ? msg.nickname.trim() : '';
        if (!nickname || nickname.length > NICKNAME_MAX) return;
        if (matches.has(player) || waiting.some((w) => w.id === player)) return;
        const other = waiting.shift();
        if (other) create(other, { id: player, nickname });
        else waiting.push({ id: player, nickname });
        return;
      }
      if (msg.type === 'match.cancel') return leaveQueue(player);

      const match = matches.get(player);
      if (!match) return;
      const me = sideOf(match, player);
      if (me.over) return;
      if (msg.type === 'move') {
        if (!DIRECTIONS.has(msg.dir) || !Number.isInteger(msg.turn)) return;
        me.moves.push({ dir: msg.dir, turn: msg.turn });
        env.send(opponentOf(match, player).id, { type: 'move', dir: msg.dir, turn: msg.turn });
      } else if (msg.type === 'gameover') {
        if (!Number.isFinite(msg.score) || !Number.isFinite(msg.maxTile) || !REASONS.has(msg.reason)) return;
        me.over = { score: msg.score, maxTile: msg.maxTile, reason: msg.reason };
        env.send(opponentOf(match, player).id, { type: 'opponent.over', score: msg.score, reason: msg.reason });
        if (match.sides.every((s) => s.over)) finish(match);
      }
    },

    // 대기 중이면 대기열에서 뺀다. 진행 중인 대결은 7-B(끊김 처리)에서 다룬다.
    disconnect: leaveQueue,

    // 서버 중지: 예약된 시간 상한 알림을 모두 취소한다 (진행 중인 대결은 결과 없이 사라진다)
    close(): void {
      for (const match of new Set(matches.values())) match.cancel();
      matches.clear();
      waiting.length = 0;
    },

    status: () => ({ waiting: waiting.length, matches: [...new Set(matches.values())].map((m) => m.sides.map((s) => s.nickname) as [string, string]) }),
  };
}
