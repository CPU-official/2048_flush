import { describe, expect, it } from 'vitest';
import { createGame, isStuck, maxTile, move, replay, type Direction, type GameState } from './game';
import { rngNext } from './rng';

const withBoard = (board: number[]): GameState => ({ board, score: 0, moves: 0, rng: 1, over: false });
// 스폰된 칸을 지워 이동/머지 결과만 비교한다.
const slid = (board: number[], dir: Direction) => {
  const r = move(withBoard(board), dir);
  const out = [...r.state.board];
  for (const e of r.events) if (e.type === 'spawn') out[e.at] = 0;
  return { ...r, out };
};

describe('rng', () => {
  it('같은 시드는 같은 수열을 만든다', () => {
    const seq = (s: number) => {
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = rngNext(s);
        s = r.state;
        out.push(r.value);
      }
      return out;
    };
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
    expect(seq(42).every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('createGame', () => {
  it('타일 2개로 시작한다', () => {
    const g = createGame(7);
    expect(g.board.filter((v) => v !== 0)).toHaveLength(2);
    expect(g.score).toBe(0);
    expect(g.moves).toBe(0);
  });
});

describe('move', () => {
  it('왼쪽으로 밀고 머지한다', () => {
    const r = slid([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'left');
    expect(r.out[0]).toBe(4);
    expect(r.gained).toBe(4);
    expect(r.state.score).toBe(4);
    expect(r.state.moves).toBe(1);
  });

  it('한 수에 같은 타일은 한 번만 머지된다', () => {
    expect(slid([2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'left').out.slice(0, 4)).toEqual([4, 4, 0, 0]);
    expect(slid([4, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'left').out.slice(0, 4)).toEqual([4, 4, 0, 0]);
    // 미는 쪽에 가까운 쌍이 먼저 머지된다
    expect(slid([2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'right').out.slice(0, 4)).toEqual([0, 0, 2, 4]);
  });

  it('위/아래로 민다', () => {
    const board = [2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0];
    expect(slid(board, 'up').out.filter((_, i) => i % 4 === 0)).toEqual([4, 4, 0, 0]);
    expect(slid(board, 'down').out.filter((_, i) => i % 4 === 0)).toEqual([0, 0, 4, 4]);
  });

  it('보드가 변하지 않는 입력은 수로 세지 않는다', () => {
    const state = withBoard([2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = move(state, 'left');
    expect(r.moved).toBe(false);
    expect(r.events).toEqual([]);
    expect(r.state).toBe(state);
  });

  it('이동, 머지, 스폰 이벤트를 순서대로 낸다', () => {
    const r = move(withBoard([2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'left');
    expect(r.events.slice(0, 2)).toEqual([
      { type: 'move', from: 2, to: 0, value: 2 },
      { type: 'merge', at: 0, value: 4 },
    ]);
    expect(r.events[2].type).toBe('spawn');
    expect(r.events).toHaveLength(3);
  });

  it('입력 상태를 바꾸지 않는다', () => {
    const state = withBoard([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const copy = structuredClone(state);
    move(state, 'right');
    expect(state).toEqual(copy);
  });
});

describe('isStuck', () => {
  it('빈칸도 인접한 같은 값도 없으면 스턱', () => {
    const stuck = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
    expect(isStuck(stuck)).toBe(true);
    expect(isStuck([...stuck.slice(0, 15), 0])).toBe(false);
    expect(isStuck([...stuck.slice(0, 15), 4])).toBe(false); // 위 칸(4)과 머지 가능
  });

  it('마지막 수로 스턱이 되면 over가 켜진다', () => {
    // 왼쪽으로 밀면 빈칸 하나에 2 또는 4가 스폰되어 가득 찬다
    const r = move(withBoard([0, 8, 16, 32, 64, 128, 256, 512, 1024, 8, 16, 32, 64, 128, 256, 512]), 'left');
    expect(r.state.over).toBe(true);
    expect(maxTile(r.state.board)).toBe(1024);
  });
});

describe('리플레이', () => {
  const dirs: Direction[] = ['left', 'up', 'right', 'down'];
  const play = (seed: number, count: number) => {
    let state = createGame(seed);
    let pick = seed;
    const log: Direction[] = [];
    while (log.length < count && !state.over) {
      const r = rngNext(pick);
      pick = r.state;
      const dir = dirs[Math.floor(r.value * 4)];
      log.push(dir); // 무효 입력도 로그에 남겨 재생 시 무시되는지 본다
      state = move(state, dir).state;
    }
    return { state, log };
  };

  it('같은 시드와 입력 로그는 같은 보드를 만든다', () => {
    for (const seed of [1, 2, 20261111]) {
      const { state, log } = play(seed, 500);
      expect(replay(seed, log)).toEqual(state);
      expect(replay(seed, log)).toEqual(replay(seed, log));
    }
  });

  it('로그 중간까지 재생한 뒤 이어서 재생해도 같다 (재접속 복원)', () => {
    const { state, log } = play(99, 200);
    const half = replay(99, log.slice(0, 100));
    expect(log.slice(100).reduce((s, d) => move(s, d).state, half)).toEqual(state);
  });

  it('시드가 다르면 보드가 달라진다', () => {
    const { log } = play(5, 50);
    expect(replay(5, log)).not.toEqual(replay(6, log));
  });

  it('점수는 머지된 값의 합이고 스턱까지 진행된다', () => {
    const { state, log } = play(3, 100000);
    expect(state.over).toBe(true);
    expect(isStuck(state.board)).toBe(true);
    let s = createGame(3);
    let sum = 0;
    for (const dir of log) {
      const r = move(s, dir);
      sum += r.events.reduce((acc, e) => acc + (e.type === 'merge' ? e.value : 0), 0);
      s = r.state;
    }
    expect(sum).toBeGreaterThan(0);
    expect(state.score).toBe(sum);
  });

  it('시드 1의 시작 보드는 고정이다 (RNG 회귀 기준값)', () => {
    const g = createGame(1);
    expect(g.board.flatMap((v, i) => (v ? [[i, v]] : []))).toEqual([[7, 2], [10, 4]]);
    expect(g.rng).toBe(-1263671339);
  });
});
