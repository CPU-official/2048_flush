import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMER, MATCH_COUNTDOWN, MATCH_TIME_LIMIT } from '../../src/constants';
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
