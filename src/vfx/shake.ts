import gsap from 'gsap';
import type { Container } from 'pixi.js';

const STEPS = 6;
const STEP_TIME = 0.04;

// 무작위 방향으로 흔들리며 잦아들다가 원점(0, 0)으로 돌아온다.
export function shake(target: Container, px: number): void {
  gsap.killTweensOf(target);
  const tl = gsap.timeline();
  for (let i = 0; i < STEPS; i++) {
    const power = px * (1 - i / STEPS);
    tl.to(target, { x: (Math.random() * 2 - 1) * power, y: (Math.random() * 2 - 1) * power, duration: STEP_TIME });
  }
  tl.to(target, { x: 0, y: 0, duration: STEP_TIME });
}
