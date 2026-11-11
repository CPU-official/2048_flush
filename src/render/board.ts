import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { SIZE, type GameEvent } from '../core/game';

const CELL = 110;
const GAP = 14;
const MOVE_TIME = 0.09;
const POP_TIME = 0.12;
export const BOARD_PX = SIZE * CELL + (SIZE + 1) * GAP;

// 2, 4, 8, ... 2048 순. 그 이상은 마지막 색을 쓴다.
const COLORS = [0x262626, 0x333333, 0x1f5a3a, 0x178a4c, 0x12b85a, 0x39ff14, 0xb6ff00, 0xffe600, 0xff9d00, 0xff4d6d, 0xffffff];
const DARK_TEXT_FROM = 5; // 이 단계부터 타일이 밝아 글자를 어둡게 한다

export function tileColor(value: number): number {
  return COLORS[Math.min(Math.log2(value), COLORS.length) - 1];
}

export function cellCenter(cell: number): { x: number; y: number } {
  return {
    x: GAP + (cell % SIZE) * (CELL + GAP) + CELL / 2,
    y: GAP + Math.floor(cell / SIZE) * (CELL + GAP) + CELL / 2,
  };
}

function makeTile(value: number, cell: number): Container {
  const tile = new Container();
  const label = new Text({
    text: String(value),
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontWeight: '900',
      fontSize: value < 100 ? 52 : value < 1000 ? 44 : 34,
      fill: Math.log2(value) > DARK_TEXT_FROM ? 0x061203 : 0xf2f2f2,
    },
  });
  label.anchor.set(0.5);
  tile.addChild(new Graphics().roundRect(-CELL / 2, -CELL / 2, CELL, CELL, 22).fill(tileColor(value)), label);
  tile.position.copyFrom(cellCenter(cell));
  return tile;
}

export class BoardView extends Container {
  private tiles = new Map<number, Container>();
  private layer = new Container();
  private tl?: gsap.core.Timeline;

  constructor() {
    super();
    const bg = new Graphics().roundRect(0, 0, BOARD_PX, BOARD_PX, 36).fill(0x141414).stroke({ width: 1, color: 0xffffff, alpha: 0.1 });
    for (let i = 0; i < SIZE * SIZE; i++) {
      const { x, y } = cellCenter(i);
      bg.roundRect(x - CELL / 2, y - CELL / 2, CELL, CELL, 22).fill(0x1b1b1b);
    }
    this.addChild(bg, this.layer);
  }

  reset(board: number[]): void {
    this.tl?.progress(1);
    for (const child of this.layer.removeChildren()) child.destroy({ children: true });
    this.tiles.clear();
    board.forEach((value, cell) => {
      if (value) this.tiles.set(cell, this.layer.addChild(makeTile(value, cell)));
    });
  }

  apply(events: GameEvent[]): void {
    this.tl?.progress(1); // 빠른 연속 입력: 이전 연출을 즉시 끝내고 시작한다
    const tl = (this.tl = gsap.timeline());
    const movedFrom = new Set(events.flatMap((e) => (e.type === 'move' ? [e.from] : [])));
    const next = new Map([...this.tiles].filter(([cell]) => !movedFrom.has(cell)));
    const dying: Container[] = [];

    for (const e of events) {
      if (e.type === 'move') {
        const tile = this.tiles.get(e.from)!;
        tl.to(tile, { ...cellCenter(e.to), duration: MOVE_TIME, ease: 'power2.out' }, 0);
        const there = next.get(e.to); // 같은 칸에 먼저 도착한 타일 = 머지 상대
        if (there) dying.push(there);
        next.set(e.to, tile);
      } else {
        if (e.type === 'merge') dying.push(next.get(e.at)!);
        const tile = this.layer.addChild(makeTile(e.value, e.at));
        tile.scale.set(0);
        tl.to(tile.scale, { x: 1, y: 1, duration: POP_TIME, ease: e.type === 'merge' ? 'back.out(3)' : 'power2.out' }, MOVE_TIME);
        next.set(e.at, tile);
      }
    }
    tl.call(() => dying.forEach((tile) => tile.destroy({ children: true })), [], MOVE_TIME);
    this.tiles = next;
  }
}
