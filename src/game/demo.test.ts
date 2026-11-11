import { describe, expect, it } from 'vitest';
import { maxTile, replay, type Direction } from '../core/game';
import log from '../assets/demo-log.json';
import { Demo } from './demo';

// core 규칙이나 RNG가 바뀌면 기록한 로그가 어긋나 이 테스트가 깨진다 (그러면 로그를 다시 기록한다).
describe('데모 로그', () => {
  it('모든 수가 보드를 바꾸고, 끝까지 재생하면 core 리플레이와 같다', () => {
    const demo = new Demo(log);
    let count = 0;
    for (let r = demo.next(); r; r = demo.next()) {
      expect(r.moved, `${count}번째 수`).toBe(true);
      count++;
    }
    const dirs = [...log.moves].map((c) => ({ l: 'left', r: 'right', u: 'up', d: 'down' })[c] as Direction);
    expect(count).toBe(log.moves.length);
    expect(demo.state).toEqual(replay(log.seed, dirs));
    expect(demo.state.over).toBe(false);
  });

  it('보여 줄 만한 판이다 (충분히 길고 큰 타일이 나온다)', () => {
    const demo = new Demo(log);
    while (demo.next());
    expect(log.moves.length).toBeGreaterThan(200);
    expect(maxTile(demo.state.board)).toBeGreaterThanOrEqual(512);
  });

  it('끝나면 null을 돌려주고, restart하면 처음부터 같은 판이 된다', () => {
    const demo = new Demo(log);
    const first = demo.state;
    while (demo.next());
    expect(demo.next()).toBeNull();
    expect(demo.restart()).toEqual(first);
    expect(demo.next()?.moved).toBe(true);
  });
});
