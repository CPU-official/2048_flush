import { rngNext } from './rng';

export const SIZE = 4;
const FOUR_CHANCE = 0.1;

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface GameState {
  board: number[]; // 길이 SIZE*SIZE, 행 우선, 0 = 빈칸
  score: number;
  moves: number; // 유효한 수의 횟수 (제한 시간 곡선의 n)
  rng: number;
  over: boolean; // 더 움직일 수 없음(stuck)
}

export type GameEvent =
  | { type: 'move'; from: number; to: number; value: number } // 머지될 타일의 이동도 포함
  | { type: 'merge'; at: number; value: number }
  | { type: 'spawn'; at: number; value: number };

export interface MoveResult {
  state: GameState;
  events: GameEvent[];
  moved: boolean;
  gained: number;
}

function spawn(board: number[], rng: number): { rng: number; event: GameEvent } {
  const empty = board.flatMap((v, i) => (v === 0 ? [i] : []));
  const pick = rngNext(rng);
  const four = rngNext(pick.state);
  const at = empty[Math.floor(pick.value * empty.length)];
  const value = four.value < FOUR_CHANCE ? 4 : 2;
  board[at] = value;
  return { rng: four.state, event: { type: 'spawn', at, value } };
}

// 각 줄의 칸 번호를 타일이 쌓이는 쪽부터 나열한다.
function lines(dir: Direction): number[][] {
  return Array.from({ length: SIZE }, (_, i) =>
    Array.from({ length: SIZE }, (_, j) => {
      const k = dir === 'left' || dir === 'up' ? j : SIZE - 1 - j;
      return dir === 'left' || dir === 'right' ? i * SIZE + k : k * SIZE + i;
    }),
  );
}

export function isStuck(board: number[]): boolean {
  return board.every((v, i) => {
    if (v === 0) return false;
    const right = i % SIZE < SIZE - 1 && board[i + 1] === v;
    const down = i + SIZE < board.length && board[i + SIZE] === v;
    return !right && !down;
  });
}

export function maxTile(board: number[]): number {
  return Math.max(...board);
}

export function createGame(seed: number): GameState {
  const board = new Array<number>(SIZE * SIZE).fill(0);
  let rng = seed | 0;
  rng = spawn(board, rng).rng;
  rng = spawn(board, rng).rng;
  return { board, score: 0, moves: 0, rng, over: false };
}

export function move(state: GameState, dir: Direction): MoveResult {
  const board = new Array<number>(SIZE * SIZE).fill(0);
  const moves: GameEvent[] = [];
  const merges: GameEvent[] = [];
  let gained = 0;

  for (const line of lines(dir)) {
    let target = 0;
    let canMerge = false; // 한 번 머지된 타일은 같은 수에 다시 머지되지 않는다
    for (const from of line) {
      const value = state.board[from];
      if (value === 0) continue;
      if (canMerge && board[line[target - 1]] === value) {
        const to = line[target - 1];
        board[to] = value * 2;
        gained += value * 2;
        moves.push({ type: 'move', from, to, value });
        merges.push({ type: 'merge', at: to, value: value * 2 });
        canMerge = false;
      } else {
        const to = line[target++];
        board[to] = value;
        if (from !== to) moves.push({ type: 'move', from, to, value });
        canMerge = true;
      }
    }
  }

  if (moves.length === 0) return { state, events: [], moved: false, gained: 0 };

  const spawned = spawn(board, state.rng);
  return {
    state: {
      board,
      score: state.score + gained,
      moves: state.moves + 1,
      rng: spawned.rng,
      over: isStuck(board),
    },
    events: [...moves, ...merges, spawned.event],
    moved: true,
    gained,
  };
}

export function replay(seed: number, log: Direction[]): GameState {
  return log.reduce((state, dir) => move(state, dir).state, createGame(seed));
}
