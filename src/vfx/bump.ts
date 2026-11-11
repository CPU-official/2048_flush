import gsap from 'gsap';
import type { Container } from 'pixi.js';
import type { Direction } from '../core/game';

const BUMP_PX = 14;
const OFFSET: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

// 이동 방향으로 살짝 밀렸다가 원점(0, 0)으로 돌아온다.
export function bump(target: Container, dir: Direction): void {
  const [dx, dy] = OFFSET[dir];
  gsap.killTweensOf(target);
  gsap.fromTo(target, { x: dx * BUMP_PX, y: dy * BUMP_PX }, { x: 0, y: 0, duration: 0.3, ease: 'elastic.out(1, 0.5)' });
}
