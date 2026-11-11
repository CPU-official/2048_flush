import { Application, Container } from 'pixi.js';
import { DEFAULT_TIMER, IDLE_LOGOUT } from './constants';
import type { Direction } from './core/game';
import { GameSession } from './game/session';
import { BOARD_PX, BoardView, cellCenter, tileColor } from './render/board';
import './ui/style.css';
import * as ui from './ui/ui';
import { bump } from './vfx/bump';
import { Particles } from './vfx/particles';

// e.code 기준: 한글 입력기나 Caps Lock 상태에서도 WASD가 동작한다
const KEYS: Record<string, Direction> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
};
const BURST_BASE = 6; // 머지 값이 클수록 파티클이 늘어난다

const app = new Application();
await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true });
document.getElementById('stage')!.appendChild(app.canvas);
document.documentElement.style.setProperty('--board', `${BOARD_PX}px`);

const world = new Container(); // 창 가운데에 두고, 튕김은 board 자체 좌표로 한다
const board = new BoardView();
const particles = new Particles();
world.addChild(board, particles);
app.stage.addChild(world);

let session: GameSession | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function startGame(): void {
  clearTimeout(idleTimer);
  session = new GameSession((Math.random() * 2 ** 32) | 0, DEFAULT_TIMER, performance.now());
  board.reset(session.state.board);
  world.visible = true;
  ui.showGame();
}

function quit(): void {
  clearTimeout(idleTimer);
  session = null;
  world.visible = false;
  ui.showStart();
}

// 종료 팝업에서 입력이 없으면 종료와 동일하게 처리한다.
function armIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(quit, IDLE_LOGOUT * 1000);
}

function gameOver(): void {
  ui.showPopup(session!.ended!, session!.state.score);
  armIdle();
}

window.addEventListener('keydown', (e) => {
  if (session?.ended) return armIdle();
  const dir = KEYS[e.code];
  if (!dir || !session || e.repeat) return;
  e.preventDefault();
  const result = session.input(dir, performance.now());
  if (result) {
    board.apply(result.events);
    bump(board, dir);
    for (const ev of result.events) {
      if (ev.type !== 'merge') continue;
      const { x, y } = cellCenter(ev.at);
      particles.burst(x, y, tileColor(ev.value), BURST_BASE + Math.log2(ev.value));
    }
    ui.setScore(session.state.score, result.gained);
  }
  if (session.ended) gameOver();
});
window.addEventListener('pointermove', () => {
  if (session?.ended) armIdle();
});

ui.onAction((act) => {
  if (act === 'play' || act === 'again') startGame();
  if (act === 'quit') quit();
});

app.ticker.add(() => {
  world.position.set((app.screen.width - BOARD_PX) / 2, (app.screen.height - BOARD_PX) / 2);
  particles.update(app.ticker.deltaMS / 1000);
  if (!session || session.ended) return;
  const now = performance.now();
  if (session.tick(now)) return gameOver();
  ui.setTime(Math.max(0, session.remaining(now) / session.limit()));
});

quit();
