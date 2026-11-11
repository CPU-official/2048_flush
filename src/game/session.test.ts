import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMER, GRACE } from '../constants';
import type { Direction } from '../core/game';
import { GameSession } from './session';
import { timeLimit } from './timer';

const dirs: Direction[] = ['left', 'up', 'right', 'down'];
// 보드가 실제로 변하는 수를 하나 둔다.
const validMove = (s: GameSession, now: number) => dirs.some((d) => s.input(d, now));

describe('timeLimit', () => {
  it('S자 곡선으로 시작값에서 최솟값까지 줄어든다', () => {
    expect(timeLimit(0, DEFAULT_TIMER)).toBeCloseTo(3.0 - 2.0 / (1 + Math.exp(4)), 10);
    expect(timeLimit(40, DEFAULT_TIMER)).toBeCloseTo(2.0, 10);
    expect(timeLimit(1000, DEFAULT_TIMER)).toBeCloseTo(1.0, 5);
    for (let n = 0; n < 200; n++) {
      expect(timeLimit(n + 1, DEFAULT_TIMER)).toBeLessThan(timeLimit(n, DEFAULT_TIMER));
    }
  });
});

describe('GameSession', () => {
  it('제한 시간 + 유예 안의 입력은 살린다', () => {
    const s = new GameSession(1, DEFAULT_TIMER, 0);
    const limitMs = s.limit() * 1000;
    expect(s.tick(limitMs + GRACE * 1000 - 1)).toBeNull();
    expect(validMove(s, limitMs + GRACE * 1000 - 1)).toBe(true);
    expect(s.ended).toBeNull();
  });

  it('유예까지 지나면 timeout으로 끝나고 입력을 받지 않는다', () => {
    const s = new GameSession(1, DEFAULT_TIMER, 0);
    const late = (s.limit() + GRACE) * 1000 + 1;
    expect(validMove(s, late)).toBe(false);
    expect(s.ended).toBe('timeout');
    expect(s.state.moves).toBe(0);
  });

  it('유효한 수는 타이머를 리셋하고 n을 올린다', () => {
    const s = new GameSession(1, DEFAULT_TIMER, 0);
    validMove(s, 1000);
    expect(s.state.moves).toBe(1);
    expect(s.remaining(1000)).toBeCloseTo(timeLimit(1, DEFAULT_TIMER), 10);
  });

  it('무효 입력은 타이머를 리셋하지 않는다', () => {
    const s = new GameSession(1, DEFAULT_TIMER, 0);
    // 같은 방향으로 계속 밀면 언젠가 보드가 변하지 않는다
    let now = 0;
    while (s.input('left', now)) now += 10;
    const before = s.remaining(now + 500);
    expect(s.input('left', now + 500)).toBeNull();
    expect(s.remaining(now + 500)).toBe(before);
  });

  it('진행 중 설정이 바뀌어도 시작 시점 값을 쓴다', () => {
    const settings = { ...DEFAULT_TIMER };
    const s = new GameSession(1, settings, 0);
    settings.start = 10;
    expect(s.limit()).toBeCloseTo(timeLimit(0, DEFAULT_TIMER), 10);
  });

  it('스턱이 되면 stuck으로 끝난다', () => {
    const s = new GameSession(3, { ...DEFAULT_TIMER, start: 1e9 }, 0);
    for (let i = 0; i < 100000 && !s.ended; i++) s.input(dirs[i % 4], 0);
    expect(s.ended).toBe('stuck');
    expect(s.input('left', 0)).toBeNull();
  });
});
