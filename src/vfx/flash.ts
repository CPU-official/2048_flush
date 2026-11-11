import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';

const DURATION = 0.35;

// 화면 전체를 color로 번쩍이고 사라진다. 한 수에 한 번만 부르므로 동시에 몇 개 넘게 쌓이지 않는다.
export function flash(stage: Container, width: number, height: number, color: number, alpha: number): void {
  const g = stage.addChild(new Graphics().rect(0, 0, width, height).fill(color));
  g.alpha = alpha;
  gsap.to(g, { alpha: 0, duration: DURATION, ease: 'power2.out', onComplete: () => g.destroy() });
}
