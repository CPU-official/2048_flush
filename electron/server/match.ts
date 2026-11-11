import { MATCH_COUNTDOWN, MATCH_TIME_LIMIT, NICKNAME_MAX, RECONNECT_WAIT } from '../../src/constants';
import type { Direction } from '../../src/core/game';
import type { TimerSettings } from '../../src/game/timer';
import type { ClientMessage, GameOverReason, MatchOutcome, MatchSide, ResultReason, ServerMessage } from '../../src/net/messages';

// 1대1 대결 매칭/중계/판정/재접속. ws, 시계, 난수를 모르는 순수 로직이라 가짜 환경으로 테스트한다 (docs/networking.md "대결 진행 흐름", "예외 처리").
export interface MatchEnv {
  send(player: number, msg: ServerMessage): void;
  timer(): TimerSettings;
  random(): number; // 0 이상 1 미만
  now(): number; // ms
  after(ms: number, fn: () => void): () => void; // 예약. 돌려주는 함수로 취소
}

interface Side {
  id: number; // 연결 id. 끊겨 있으면 OFFLINE
  nickname: string;
  moves: Direction[]; // 재접속 복원용 입력 로그
  over: { score: number; maxTile: number; reason: GameOverReason } | null;
  offline: boolean; // 끊겼다는 것을 상대에게 알렸다
  forfeit: () => void; // 부전승 예약 취소
}
interface Match {
  id: string;
  sides: [Side, Side];
  seed: number;
  timer: TimerSettings;
  startAt: number; // 카운트다운이 끝나 게임이 시작되는 시각
  timeUp: boolean;
  timeUpCancel: () => void;
}

const OFFLINE = -1;
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const REASONS = new Set(['stuck', 'timeout', 'matchTime']);
const noop = () => {};

export function createMatches(env: MatchEnv) {
  const waiting: { id: number; nickname: string }[] = [];
  const byPlayer = new Map<number, Match>(); // 연결 id → 그 사람의 대결
  const byId = new Map<string, Match>(); // 대결 id → 대결 (끊겨 있는 사람이 있어도 남는다)
  let counter = 0;

  const leaveQueue = (player: number) => {
    const i = waiting.findIndex((w) => w.id === player);
    if (i >= 0) waiting.splice(i, 1);
  };
  const opponentOf = (match: Match, id: number) => (match.sides[0].id === id ? match.sides[1] : match.sides[0]);
  const sideOf = (match: Match, id: number) => (match.sides[0].id === id ? match.sides[0] : match.sides[1]);
  const otherSide = (match: Match, side: Side) => (match.sides[0] === side ? match.sides[1] : match.sides[0]); // 끊긴 사람은 id가 같을 수 있어 객체로 구분한다
  const tell = (side: Side, msg: ServerMessage) => side.id !== OFFLINE && env.send(side.id, msg);

  // 결과 없이 대결을 정리한다
  function discard(match: Match): void {
    match.timeUpCancel();
    for (const s of match.sides) {
      s.forfeit();
      byPlayer.delete(s.id);
    }
    byId.delete(match.id);
  }

  function finish(match: Match, reason: ResultReason = match.timeUp ? 'timeLimit' : 'normal'): void {
    const [a, b] = match.sides;
    const [sa, sb] = [a.over?.score ?? 0, b.over?.score ?? 0];
    const outcome = (mine: number, theirs: number): MatchOutcome => (mine > theirs ? 'win' : mine < theirs ? 'lose' : 'draw');
    tell(a, { type: 'result', outcome: outcome(sa, sb), score: sa, opponentScore: sb, reason });
    tell(b, { type: 'result', outcome: outcome(sb, sa), score: sb, opponentScore: sa, reason });
    discard(match);
  }

  // side가 돌아오지 않았다: 남은 사람의 부전승. 남은 사람도 없으면 결과 없이 정리한다.
  function forfeit(match: Match, side: Side): void {
    const rest = otherSide(match, side);
    if (rest.id === OFFLINE) return discard(match);
    const [mine, theirs] = [rest.over?.score ?? 0, side.over?.score ?? 0];
    tell(rest, { type: 'result', outcome: 'win', score: mine, opponentScore: theirs, reason: 'forfeit' }); // 점수는 gameover로 보고된 값이다 (없으면 0)
    discard(match);
  }

  function create(first: { id: number; nickname: string }, second: { id: number; nickname: string }): void {
    const make = (p: { id: number; nickname: string }): Side => ({ ...p, moves: [], over: null, offline: false, forfeit: noop });
    const sides: [Side, Side] = [make(first), make(second)];
    const match: Match = {
      id: String(++counter),
      sides,
      seed: Math.floor(env.random() * 2 ** 32) | 0,
      timer: env.timer(),
      startAt: env.now() + MATCH_COUNTDOWN * 1000,
      timeUp: false,
      timeUpCancel: noop,
    };
    byId.set(match.id, match);
    for (const s of sides) byPlayer.set(s.id, match);
    sides.forEach((s, slot) => {
      env.send(s.id, { type: 'match.found', id: match.id, opponent: sides[1 - slot].nickname, slot: slot as 0 | 1 });
      env.send(s.id, { type: 'start', id: match.id, seed: match.seed, startIn: MATCH_COUNTDOWN * 1000, timer: match.timer, timeLimit: MATCH_TIME_LIMIT });
    });
    // 대결 시간 상한은 카운트다운이 끝나 게임이 시작된 때부터 센다
    match.timeUpCancel = env.after((MATCH_COUNTDOWN + MATCH_TIME_LIMIT) * 1000, () => {
      match.timeUp = true;
      for (const s of sides) tell(s, { type: 'match.timeup' });
    });
  }

  function resume(player: number, msg: { id: string; slot: number }): void {
    const match = byId.get(msg.id);
    if (!match || byPlayer.has(player) || (msg.slot !== 0 && msg.slot !== 1)) return;
    const me = match.sides[msg.slot];
    const rival = match.sides[1 - msg.slot];
    leaveQueue(player); // 대기 중인 연결이 resume하면 대기열에서 뺀다
    me.forfeit();
    me.forfeit = noop;
    byPlayer.delete(me.id); // 끊김을 아직 모르는 옛 연결이 남아 있다면 새 연결로 넘겨받는다
    me.id = player;
    byPlayer.set(player, match);
    if (me.offline) {
      me.offline = false;
      tell(rival, { type: 'opponent.status', status: 'online' });
    }
    const side = (s: Side): MatchSide => ({ moves: [...s.moves], over: s.over && { score: s.over.score, reason: s.over.reason } });
    env.send(player, {
      type: 'match.restore',
      restore: {
        id: match.id, slot: msg.slot, opponent: rival.nickname, seed: match.seed, timer: match.timer, timeLimit: MATCH_TIME_LIMIT,
        startIn: match.startAt - env.now(), timeUp: match.timeUp, mine: side(me), theirs: side(rival),
      },
    });
  }

  function leave(player: number): void {
    leaveQueue(player);
    const match = byPlayer.get(player);
    if (!match) return;
    const me = sideOf(match, player);
    byPlayer.delete(player);
    me.id = OFFLINE;
    me.offline = true;
    tell(otherSide(match, me), { type: 'opponent.status', status: 'offline' });
    // 이미 끝낸 사람은 점수가 정해져 있어 기다릴 필요가 없다. 상대가 끝나면 그대로 결과가 난다.
    if (!me.over) me.forfeit = env.after(RECONNECT_WAIT * 1000, () => forfeit(match, me));
  }

  return {
    // 클라이언트가 보낸 대결 메시지를 처리한다. 잘못된 메시지는 무시한다.
    handle(player: number, msg: ClientMessage): void {
      if (msg.type === 'match.find') {
        const nickname = typeof msg.nickname === 'string' ? msg.nickname.trim() : '';
        if (!nickname || nickname.length > NICKNAME_MAX) return;
        if (byPlayer.has(player) || waiting.some((w) => w.id === player)) return;
        const other = waiting.shift();
        if (other) create(other, { id: player, nickname });
        else waiting.push({ id: player, nickname });
        return;
      }
      if (msg.type === 'match.cancel') return leaveQueue(player);
      if (msg.type === 'match.resume') return resume(player, msg);

      const match = byPlayer.get(player);
      if (!match) return;
      const me = sideOf(match, player);
      if (me.over) return;
      if (msg.type === 'move') {
        if (!DIRECTIONS.has(msg.dir) || !Number.isInteger(msg.turn)) return;
        me.moves.push(msg.dir);
        tell(opponentOf(match, player), { type: 'move', dir: msg.dir, turn: msg.turn });
      } else if (msg.type === 'gameover') {
        if (!Number.isFinite(msg.score) || !Number.isFinite(msg.maxTile) || !REASONS.has(msg.reason)) return;
        me.over = { score: msg.score, maxTile: msg.maxTile, reason: msg.reason };
        tell(opponentOf(match, player), { type: 'opponent.over', score: msg.score, reason: msg.reason });
        if (match.sides.every((s) => s.over)) finish(match);
      }
    },

    // 연결이 끊겼다: 대기 중이면 대기열에서 빼고, 대결 중이면 상대에게 알리고 RECONNECT_WAIT 동안 기다린다.
    disconnect: leave,

    // 서버 중지: 예약을 모두 취소한다 (진행 중인 대결은 결과 없이 사라진다)
    close(): void {
      for (const match of [...byId.values()]) discard(match);
      waiting.length = 0;
    },

    status: () => ({ waiting: waiting.length, matches: [...byId.values()].map((m) => m.sides.map((s) => s.nickname) as [string, string]) }),
  };
}
