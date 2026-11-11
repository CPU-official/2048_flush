import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMER, MATCH_COUNTDOWN, MATCH_TIME_LIMIT, RECONNECT_WAIT } from '../../src/constants';
import type { ServerMessage } from '../../src/net/messages';
import { createMatches } from './match';

// 가짜 환경: 보낸 메시지를 모으고, 예약은 시간을 직접 흘려 실행한다.
let sent: [number, ServerMessage][];
let jobs: { at: number; fn: () => void; live: boolean }[];
let now: number;
let m: ReturnType<typeof createMatches>;
const to = (id: number, type: string) => sent.filter(([p, msg]) => p === id && msg.type === type).map(([, msg]) => msg);
const advance = (ms: number) => {
  now += ms;
  for (const j of jobs) if (j.live && j.at <= now) ((j.live = false), j.fn());
};
const pair = () => {
  m.handle(1, { type: 'match.find', nickname: 'kim' });
  m.handle(2, { type: 'match.find', nickname: 'lee' });
};
const over = (id: number, score: number, reason: 'stuck' | 'timeout' | 'matchTime' = 'stuck') => m.handle(id, { type: 'gameover', score, maxTile: 64, reason });

beforeEach(() => {
  sent = [];
  jobs = [];
  now = 0;
  m = createMatches({
    send: (p, msg) => sent.push([p, msg]),
    timer: () => DEFAULT_TIMER,
    random: () => 0.5,
    now: () => now,
    after: (ms, fn) => {
      const job = { at: now + ms, fn, live: true };
      jobs.push(job);
      return () => (job.live = false);
    },
  });
});

describe('매칭', () => {
  it('혼자면 대기하고, 둘째가 오면 선착순으로 짝이 지어져 같은 시드의 start를 받는다', () => {
    m.handle(1, { type: 'match.find', nickname: 'kim' });
    expect(m.status()).toEqual({ waiting: 1, matches: [] });
    expect(sent).toEqual([]);
    m.handle(2, { type: 'match.find', nickname: 'lee' });
    expect(m.status()).toEqual({ waiting: 0, matches: [['kim', 'lee']] });
    expect(to(1, 'match.found')).toEqual([{ type: 'match.found', id: '1', opponent: 'lee', slot: 0 }]);
    expect(to(2, 'match.found')).toEqual([{ type: 'match.found', id: '1', opponent: 'kim', slot: 1 }]);
    const [a] = to(1, 'start');
    expect(a).toEqual({ type: 'start', id: '1', seed: 2 ** 31 | 0, startIn: MATCH_COUNTDOWN * 1000, timer: DEFAULT_TIMER, timeLimit: MATCH_TIME_LIMIT });
    expect(to(2, 'start')).toEqual([a]);
  });

  it('셋째, 넷째는 따로 짝이 지어져 동시에 여러 대결이 열린다', () => {
    pair();
    m.handle(3, { type: 'match.find', nickname: 'park' });
    m.handle(4, { type: 'match.find', nickname: 'choi' });
    expect(m.status().matches).toEqual([['kim', 'lee'], ['park', 'choi']]);
    expect(to(3, 'match.found')[0]).toMatchObject({ id: '2', opponent: 'choi' });
  });

  it('취소하거나 끊긴 사람은 대기열에서 빠진다', () => {
    m.handle(1, { type: 'match.find', nickname: 'kim' });
    m.handle(1, { type: 'match.cancel' });
    m.handle(2, { type: 'match.find', nickname: 'lee' });
    m.disconnect(2);
    m.handle(3, { type: 'match.find', nickname: 'park' });
    m.handle(4, { type: 'match.find', nickname: 'choi' });
    expect(m.status().matches).toEqual([['park', 'choi']]);
  });

  it('이미 대기/대결 중인 사람의 find와 잘못된 닉네임은 무시한다', () => {
    m.handle(1, { type: 'match.find', nickname: 'kim' });
    m.handle(1, { type: 'match.find', nickname: 'kim' });
    expect(m.status().waiting).toBe(1);
    for (const bad of ['', '   ', 'x'.repeat(11), 5 as unknown as string]) m.handle(9, { type: 'match.find', nickname: bad });
    expect(m.status().waiting).toBe(1);
    m.handle(2, { type: 'match.find', nickname: 'lee' });
    m.handle(1, { type: 'match.find', nickname: 'kim' }); // 대결 중
    expect(m.status()).toEqual({ waiting: 0, matches: [['kim', 'lee']] });
  });
});

describe('중계와 판정', () => {
  it('move는 상대에게만 그대로 전달된다. 잘못된 move와 대결 밖 메시지는 무시한다', () => {
    pair();
    m.handle(1, { type: 'move', dir: 'left', turn: 0 });
    m.handle(2, { type: 'move', dir: 'up', turn: 0 });
    m.handle(1, { type: 'move', dir: 'sideways' as 'up', turn: 1 });
    m.handle(1, { type: 'move', dir: 'up', turn: 1.5 });
    m.handle(9, { type: 'move', dir: 'up', turn: 0 });
    expect(to(2, 'move')).toEqual([{ type: 'move', dir: 'left', turn: 0 }]);
    expect(to(1, 'move')).toEqual([{ type: 'move', dir: 'up', turn: 0 }]);
    expect(to(9, 'move')).toEqual([]);
  });

  it('한쪽이 끝나면 상대에게 opponent.over를 보내고, 양쪽이 끝나면 result로 승패를 가린다', () => {
    pair();
    over(1, 500, 'timeout');
    expect(to(2, 'opponent.over')).toEqual([{ type: 'opponent.over', score: 500, reason: 'timeout' }]);
    expect(to(2, 'result')).toEqual([]);
    over(2, 300);
    expect(to(1, 'result')).toEqual([{ type: 'result', outcome: 'win', score: 500, opponentScore: 300, reason: 'normal' }]);
    expect(to(2, 'result')).toEqual([{ type: 'result', outcome: 'lose', score: 300, opponentScore: 500, reason: 'normal' }]);
    expect(m.status().matches).toEqual([]); // 끝난 대결은 정리되고, 둘 다 다시 찾을 수 있다
    pair();
    expect(m.status().matches).toEqual([['kim', 'lee']]);
  });

  it('점수가 같으면 무승부', () => {
    pair();
    over(1, 100);
    over(2, 100);
    expect(to(1, 'result')[0]).toMatchObject({ outcome: 'draw' });
    expect(to(2, 'result')[0]).toMatchObject({ outcome: 'draw' });
  });

  it('끝난 사람의 move/gameover는 무시한다 (결과가 바뀌지 않는다)', () => {
    pair();
    over(1, 100);
    over(1, 9999);
    m.handle(1, { type: 'move', dir: 'up', turn: 5 });
    expect(to(2, 'opponent.over')).toHaveLength(1);
    expect(to(2, 'move')).toEqual([]);
    over(2, 50);
    expect(to(1, 'result')[0]).toMatchObject({ score: 100, opponentScore: 50 });
  });

  it('잘못된 gameover는 무시한다', () => {
    pair();
    m.handle(1, { type: 'gameover', score: NaN, maxTile: 64, reason: 'stuck' });
    m.handle(1, { type: 'gameover', score: 10, maxTile: 64, reason: 'boom' as 'stuck' });
    expect(to(2, 'opponent.over')).toEqual([]);
  });
});

describe('대결 시간 상한', () => {
  it('카운트다운이 끝난 뒤 MATCH_TIME_LIMIT이 지나면 양쪽에 match.timeup을 보내고, 현재 점수 보고로 timeLimit 결과가 난다', () => {
    pair();
    advance((MATCH_COUNTDOWN + MATCH_TIME_LIMIT) * 1000 - 1);
    expect(to(1, 'match.timeup')).toEqual([]);
    advance(1);
    expect(to(1, 'match.timeup')).toHaveLength(1);
    expect(to(2, 'match.timeup')).toHaveLength(1);
    over(1, 700, 'matchTime');
    over(2, 700, 'matchTime');
    expect(to(1, 'result')).toEqual([{ type: 'result', outcome: 'draw', score: 700, opponentScore: 700, reason: 'timeLimit' }]);
  });

  it('상한 전에 끝난 대결은 timeup을 보내지 않는다', () => {
    pair();
    over(1, 1);
    over(2, 2);
    advance((MATCH_COUNTDOWN + MATCH_TIME_LIMIT) * 1000 + 1);
    expect(to(1, 'match.timeup')).toEqual([]);
  });

  it('close는 예약을 취소한다', () => {
    pair();
    m.close();
    advance((MATCH_COUNTDOWN + MATCH_TIME_LIMIT) * 1000 + 1);
    expect(to(1, 'match.timeup')).toEqual([]);
    expect(m.status()).toEqual({ waiting: 0, matches: [] });
  });
});

describe('끊김과 재접속', () => {
  const restoreOf = (id: number) => (to(id, 'match.restore')[0] as Extract<ServerMessage, { type: 'match.restore' }>).restore;

  it('끊기면 상대에게 offline을 알리고, 돌아와 resume하면 두 사람의 입력 로그로 복원하고 online을 알린다', () => {
    pair();
    m.handle(1, { type: 'move', dir: 'left', turn: 0 });
    m.handle(2, { type: 'move', dir: 'up', turn: 0 });
    m.handle(1, { type: 'move', dir: 'down', turn: 1 });
    advance(5000); // 카운트다운이 끝나고 2초가 지났다
    m.disconnect(1);
    expect(to(2, 'opponent.status')).toEqual([{ type: 'opponent.status', status: 'offline' }]);
    expect(m.status().matches).toEqual([['kim', 'lee']]); // 기다리는 동안 대결은 남아 있다

    m.handle(10, { type: 'match.resume', id: '1', slot: 0 }); // 새 연결 10
    expect(restoreOf(10)).toEqual({
      id: '1', slot: 0, opponent: 'lee', seed: 2 ** 31 | 0, timer: DEFAULT_TIMER, timeLimit: MATCH_TIME_LIMIT,
      startIn: MATCH_COUNTDOWN * 1000 - 5000, timeUp: false,
      mine: { moves: ['left', 'down'], over: null },
      theirs: { moves: ['up'], over: null },
    });
    expect(to(2, 'opponent.status')[1]).toEqual({ type: 'opponent.status', status: 'online' });

    // 새 연결이 이어서 플레이한다
    m.handle(10, { type: 'move', dir: 'right', turn: 2 });
    expect(to(2, 'move').at(-1)).toEqual({ type: 'move', dir: 'right', turn: 2 });
    advance(RECONNECT_WAIT * 1000 + 1);
    expect(to(2, 'result')).toEqual([]); // 돌아왔으니 부전승은 없다
  });

  it('RECONNECT_WAIT 안에 돌아오지 않으면 남은 사람이 부전승하고, 다시 매칭할 수 있다', () => {
    pair();
    m.handle(2, { type: 'gameover', score: 80, maxTile: 16, reason: 'stuck' }); // 남은 사람은 먼저 끝났다
    m.disconnect(1);
    advance(RECONNECT_WAIT * 1000 - 1);
    expect(to(2, 'result')).toEqual([]);
    advance(1);
    expect(to(2, 'result')).toEqual([{ type: 'result', outcome: 'win', score: 80, opponentScore: 0, reason: 'forfeit' }]);
    expect(m.status().matches).toEqual([]);
    m.handle(10, { type: 'match.resume', id: '1', slot: 0 }); // 이미 끝난 대결로는 돌아올 수 없다
    expect(to(10, 'match.restore')).toEqual([]);
    m.handle(2, { type: 'match.find', nickname: 'lee' });
    expect(m.status().waiting).toBe(1);
  });

  it('둘 다 끊기면 결과 없이 정리된다', () => {
    pair();
    m.disconnect(1);
    m.disconnect(2);
    advance(RECONNECT_WAIT * 1000 + 1);
    expect(to(1, 'result')).toEqual([]);
    expect(to(2, 'result')).toEqual([]);
    expect(m.status().matches).toEqual([]);
  });

  it('둘 다 끊겼어도 한 쪽이 돌아오면 이어진다', () => {
    pair();
    m.disconnect(1);
    m.disconnect(2);
    advance(RECONNECT_WAIT * 1000 - 1);
    m.handle(11, { type: 'match.resume', id: '1', slot: 1 });
    expect(restoreOf(11).opponent).toBe('kim');
    advance(2);
    expect(m.status().matches).toEqual([]); // 상대는 끝내 안 돌아와 정리된다 (돌아온 사람에게 부전승 결과)
    expect(to(11, 'result')[0]).toMatchObject({ outcome: 'win', reason: 'forfeit' });
  });

  it('이미 끝낸 사람이 끊기면 기다리지 않고, 상대가 끝나면 점수대로 결과가 난다', () => {
    pair();
    over(1, 500);
    m.disconnect(1);
    advance(RECONNECT_WAIT * 1000 + 1);
    expect(to(2, 'result')).toEqual([]); // 부전승이 아니다
    over(2, 300);
    expect(to(2, 'result')).toEqual([{ type: 'result', outcome: 'lose', score: 300, opponentScore: 500, reason: 'normal' }]);
    expect(m.status().matches).toEqual([]);
  });

  it('복원에는 끝난 사람의 점수와 사유, 시간 상한 알림 여부가 들어간다', () => {
    pair();
    over(2, 120, 'timeout');
    advance((MATCH_COUNTDOWN + MATCH_TIME_LIMIT) * 1000 + 10);
    m.disconnect(1);
    m.handle(10, { type: 'match.resume', id: '1', slot: 0 });
    const r = restoreOf(10);
    expect(r.timeUp).toBe(true);
    expect(r.theirs.over).toEqual({ score: 120, reason: 'timeout' });
    expect(r.startIn).toBe(-(MATCH_TIME_LIMIT * 1000 + 10));
    expect(r.mine.over).toBeNull();
  });

  it('끊김을 모르는 옛 연결이 남아 있어도 새 연결이 슬롯을 넘겨받는다', () => {
    pair();
    m.handle(10, { type: 'match.resume', id: '1', slot: 0 });
    expect(restoreOf(10).slot).toBe(0);
    m.handle(1, { type: 'move', dir: 'up', turn: 0 }); // 옛 연결은 더 이상 대결에 속하지 않는다
    expect(to(2, 'move')).toEqual([]);
    m.handle(10, { type: 'move', dir: 'up', turn: 0 });
    expect(to(2, 'move')).toHaveLength(1);
    expect(to(2, 'opponent.status')).toEqual([]); // 끊김을 알린 적이 없으니 online도 보내지 않는다
  });

  it('잘못된 resume은 무시한다', () => {
    pair();
    m.disconnect(1);
    for (const bad of [{ id: '9', slot: 0 }, { id: '1', slot: 2 }, { id: '1', slot: -1 }]) {
      m.handle(10, { type: 'match.resume', ...bad } as never);
    }
    m.handle(2, { type: 'match.resume', id: '1', slot: 0 }); // 이미 대결 중인 연결
    expect(to(10, 'match.restore')).toEqual([]);
    expect(to(2, 'match.restore')).toEqual([]);
  });

  it('close는 부전승 예약도 취소한다', () => {
    pair();
    m.disconnect(1);
    m.close();
    advance(RECONNECT_WAIT * 1000 + 1);
    expect(to(2, 'result')).toEqual([]);
    expect(m.status()).toEqual({ waiting: 0, matches: [] });
  });
});
