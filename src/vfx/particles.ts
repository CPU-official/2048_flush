import { Container, Graphics } from 'pixi.js';

const MAX_PARTICLES = 200; // 60fps 유지를 위한 상한
const LIFE = 0.5; // 초
const SPEED = 420; // px/초

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
}

export class Particles extends Container {
  private live: Particle[] = [];

  burst(x: number, y: number, color: number, count: number): void {
    for (let i = 0; i < count && this.live.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = SPEED * (0.3 + Math.random() * 0.7);
      const g = this.addChild(new Graphics().rect(-4, -4, 8, 8).fill(color));
      g.position.set(x, y);
      this.live.push({ g, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: LIFE });
    }
  }

  update(dt: number): void {
    this.live = this.live.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        p.g.destroy();
        return false;
      }
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.g.alpha = p.life / LIFE;
      p.g.scale.set(p.life / LIFE);
      return true;
    });
  }
}
