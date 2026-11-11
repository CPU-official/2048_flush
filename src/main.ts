import { Application, Container } from 'pixi.js';
import demoLog from './assets/demo-log.json';
import { DEMO_END_PAUSE, DEMO_STEP, IDLE_LOGOUT, NICKNAME_MAX, RANK_TOP } from './constants';
import { maxTile, type Direction } from './core/game';
import { validAccount, type Account } from './game/account';
import { Demo } from './game/demo';
import { GameSession } from './game/session';
import type { AppState } from './net/admin';
import { NetClient, testConnection } from './net/client';
import type { RankScope } from './net/messages';
import { BOARD_PX, BoardView, cellCenter, tileColor } from './render/board';
import './ui/style.css';
import * as ui from './ui/ui';
import { initConsole } from './ui/console/console';
import { initSettings, openSettings, setConnected } from './ui/settings';
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

// 시작 화면 오른쪽에서 기록된 판을 반복 재생한다 (시작 화면일 때만 보인다)
const demoWorld = new Container();
const demoBoard = new BoardView();
demoWorld.addChild(demoBoard);
app.stage.addChild(demoWorld);
const demo = new Demo(demoLog);
demoBoard.reset(demo.state.board);
let demoWait = DEMO_STEP;
let demoEnded = false;

const net = new NetClient();
net.onChange = () => {
  ui.setStatus(net.connected, net.queue.length);
  setConnected(net.connected);
};
net.onChange();

let vfx = true; // 이 PC 설정. 끄면 파티클과 보드 튕김을 생략한다
let connectTo = '';
// 관리 함수가 돌려준 상태에 이 PC의 클라이언트를 맞춘다.
function applyState(state: AppState): void {
  vfx = state.vfx;
  if (state.connectTo === connectTo) return;
  connectTo = state.connectTo;
  if (connectTo) net.connect(connectTo);
  else net.disconnect();
}
if (window.api) {
  const runAdmin = async (name: string, ...args: unknown[]) => {
    const result = await window.api!.admin(name, ...args);
    applyState(result.state);
    return result;
  };
  initSettings(runAdmin, testConnection);
  initConsole(runAdmin); // 설정 화면 버튼과 같은 관리 함수를 부른다
  window.api.admin('state').then((result) => applyState(result.state));
}

let session: GameSession | null = null;
let account: Account | null = null; // 메모리에만 둔다. 종료/무입력 시 비운다
let rankingView = 0; // 랭킹 팝업을 열거나 닫을 때마다 올린다
let gameId = ''; // 게임마다 새로 만든다. 서버가 중복 제출을 걸러내는 키
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function startGame(): void {
  clearTimeout(idleTimer);
  session = new GameSession((Math.random() * 2 ** 32) | 0, net.timer, performance.now());
  gameId = crypto.randomUUID();
  board.reset(session.state.board);
  world.visible = true;
  demoWorld.visible = false;
  ui.showGame(account?.nickname ?? null);
  if (account) {
    const id = gameId;
    net.ranking('player', account.nickname, 1).then((entries) => {
      if (id === gameId && entries?.[0]) ui.setBest(entries[0].score);
    });
  }
}

function quit(): void {
  clearTimeout(idleTimer);
  session = null;
  account = null;
  gameId = '';
  rankingView++;
  world.visible = false;
  demoWorld.visible = true;
  ui.showStart();
}

// 종료 팝업에서 입력이 없으면 종료와 동일하게 처리한다.
function armIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(quit, IDLE_LOGOUT * 1000);
}

function gameOver(): void {
  armIdle();
  if (account) submitRecord(account);
  else ui.showAccount(session!.state.score);
}

// 기록을 제출하고 결과에 따라 입력창 또는 계속/종료 팝업을 띄운다.
async function submitRecord(who: Account): Promise<void> {
  const id = gameId;
  const { score, board: cells } = session!.state;
  const error = await net.submit({ id, ...who, score, maxTile: maxTile(cells) });
  if (id !== gameId) return; // 응답을 기다리는 사이 종료했거나 무입력으로 나갔다
  if (error === 'password' || error === 'invalid') {
    account = null;
    ui.showAccount(score, error === 'password' ? '이미 있는 닉네임이에요. 비밀번호가 달라요.' : '닉네임 또는 비밀번호 형식이 맞지 않아요.');
    return;
  }
  account = who;
  ui.showOver(session!.ended!, score, error === 'offline' ? '서버에 연결되지 않았어요. 연결되면 자동으로 기록돼요.' : '');
}

async function openRanking(scope: RankScope): Promise<void> {
  const view = ++rankingView;
  const inGame = session !== null; // 게임 오버 팝업에서 열었으면 닫을 때 그 팝업으로 돌아간다
  if (scope === 'player' && !account) return ui.showRanking(scope, [], '기록 후 확인할 수 있어요', inGame);
  const entries = await net.ranking(scope, scope === 'player' ? account!.nickname : undefined, RANK_TOP);
  if (view !== rankingView) return; // 응답을 기다리는 사이 닫았거나 다른 탭을 눌렀다
  ui.showRanking(scope, entries ?? [], entries ? (entries.length ? '' : '아직 기록이 없어요') : '서버 연결 안 됨', inGame);
}

window.addEventListener('keydown', (e) => {
  if (session?.ended) return armIdle();
  const dir = KEYS[e.code];
  if (!dir || !session || e.repeat) return;
  e.preventDefault();
  const result = session.input(dir, performance.now());
  if (result) {
    board.apply(result.events);
    if (vfx) bump(board, dir);
    for (const ev of result.events) {
      if (ev.type !== 'merge' || !vfx) continue;
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
  if (act === 'quit' || act === 'close-settings') quit();
  if (act === 'settings') openSettings().then(ui.showSettings);
  if (act === 'close-ranking') {
    rankingView++;
    if (session) ui.backToOver();
    else quit();
  }
  if (act === 'ranking' || act === 'tab-all') openRanking('all');
  if (act === 'tab-player') openRanking('player');
});

ui.onAccountSubmit((nickname, password) => {
  armIdle();
  if (!validAccount(nickname, password)) return ui.setAccountError(`닉네임은 1~${NICKNAME_MAX}자, 비밀번호는 숫자 4자리예요.`);
  submitRecord({ nickname, password });
});

app.ticker.add(() => {
  world.position.set((app.screen.width - BOARD_PX) / 2, (app.screen.height - BOARD_PX) / 2);
  particles.update(app.ticker.deltaMS / 1000);
  // 화면 오른쪽 절반의 가운데에, 창이 작으면 줄여서 놓는다
  const fit = Math.min(1, (app.screen.height * 0.8) / BOARD_PX, (app.screen.width * 0.5 * 0.85) / BOARD_PX);
  demoWorld.scale.set(fit);
  demoWorld.position.set(app.screen.width * 0.75 - (BOARD_PX * fit) / 2, (app.screen.height - BOARD_PX * fit) / 2);
  if (demoWorld.visible && (demoWait -= app.ticker.deltaMS / 1000) <= 0) {
    const result = demoEnded ? null : demo.next();
    if (result) {
      demoBoard.apply(result.events);
      demoWait = DEMO_STEP;
    } else if (!demoEnded) {
      demoEnded = true; // 로그가 끝났다: 마지막 판을 잠시 보여 준 뒤 처음부터
      demoWait = DEMO_END_PAUSE;
    } else {
      demoEnded = false;
      demoBoard.reset(demo.restart().board);
      demoWait = DEMO_STEP;
    }
  }
  if (!session || session.ended) return;
  const now = performance.now();
  if (session.tick(now)) return gameOver();
  ui.setTime(Math.max(0, session.remaining(now) / session.limit()));
});

quit();
