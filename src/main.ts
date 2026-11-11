import { Application, Container } from 'pixi.js';
import demoLog from './assets/demo-log.json';
import { DEMO_END_PAUSE, DEMO_STEP, IDLE_LOGOUT, RECORD_BURST, NICKNAME_MAX, RANK_TOP } from './constants';
import { maxTile, type Direction, type MoveResult } from './core/game';
import { validAccount, type Account } from './game/account';
import { Demo } from './game/demo';
import { Match } from './game/match';
import { GameSession } from './game/session';
import type { AppState } from './net/admin';
import { NetClient, testConnection } from './net/client';
import type { RankScope } from './net/messages';
import { BOARD_PX, BoardView, cellCenter, tileColor } from './render/board';
import './ui/style.css';
import * as ui from './ui/ui';
import { initConsole } from './ui/console/console';
import * as matchUi from './ui/match';
import { initSettings, openSettings, setConnected } from './ui/settings';
import { bump } from './vfx/bump';
import { flash } from './vfx/flash';
import { impactOf } from './vfx/impact';
import { shake } from './vfx/shake';
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
const shaker = new Container(); // 화면 흔들림 전용. board는 bump가 따로 움직이므로 한 겹 감싼다
shaker.addChild(board, particles);
world.addChild(shaker);
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

// 대결: 상대 보드는 오른쪽에 놓고 경량 VFX(이동/머지 연출)만 쓴다. 내 보드는 world를 왼쪽으로 옮겨 그대로 쓴다.
const theirsWorld = new Container();
const theirsBoard = new BoardView();
theirsWorld.addChild(theirsBoard);
theirsWorld.visible = false;
app.stage.addChild(theirsWorld);

const net = new NetClient();
const matchFlow = new Match(net);
let matchNick = ''; // 이번 대결에 쓴 닉네임 ("다시 대결 찾기"에 다시 쓴다)
let inMatch = false; // 화면이 대결 배치(좌우 두 보드)인가
net.onChange = () => {
  ui.setStatus(net.connected, net.queue.length);
  ui.setMatchEnabled(net.connected);
  setConnected(net.connected);
  if (!net.connected && matchFlow.phase === 'waiting') quit(); // 대기 중에 끊기면 처음으로
  if (net.connected) matchFlow.connected();
  else matchFlow.disconnected(performance.now());
};
net.onMatch = (msg) => matchFlow.handle(msg, performance.now());
matchFlow.onOpponentMove = (result) => theirsBoard.apply(result.events);
matchFlow.onRestore = () => {
  record = maxTile(matchFlow.mine!.state.board);
  board.reset(matchFlow.mine!.state.board);
  theirsBoard.reset(matchFlow.theirs!.board);
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
let record = 0; // 이번 게임에서 지금까지 나온 가장 큰 타일
let gameId = ''; // 게임마다 새로 만든다. 서버가 중복 제출을 걸러내는 키
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function startGame(): void {
  clearTimeout(idleTimer);
  session = new GameSession((Math.random() * 2 ** 32) | 0, net.timer, performance.now());
  gameId = crypto.randomUUID();
  board.reset(session.state.board);
  record = maxTile(session.state.board);
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
  if (matchFlow.phase === 'waiting' || matchFlow.phase === 'finished') matchFlow.leave(); // 대기 취소 또는 결과 화면에서 나가기
  inMatch = false;
  theirsWorld.visible = false;
  matchUi.clearMatchNick();
  clearTimeout(idleTimer);
  session = null;
  account = null;
  gameId = '';
  rankingView++;
  world.visible = false;
  demoWorld.visible = true;
  ui.showStart();
}

// 대결 단계가 바뀔 때 화면을 맞춘다. 대기 중 팝업은 시작 화면 위에, 카운트다운부터는 대결 화면이다.
function showMatchBackdrop(): void {
  inMatch = false;
  world.visible = false;
  theirsWorld.visible = false;
  demoWorld.visible = true;
  ui.setTime(1);
}

matchFlow.onChange = () => {
  const { phase, mine, theirs } = matchFlow;
  if (phase === 'waiting') {
    showMatchBackdrop();
    matchUi.showMatchWaiting();
  } else if (phase === 'countdown' && mine && theirs) {
    inMatch = true;
    record = maxTile(mine.state.board);
    board.reset(mine.state.board);
    theirsBoard.reset(theirs.board);
    world.visible = true;
    theirsWorld.visible = true;
    demoWorld.visible = false;
    matchUi.showMatchGame(matchNick, matchFlow.opponent);
  } else if (phase === 'finished' && matchFlow.result) {
    const r = matchFlow.result;
    const forfeit = r.reason === 'forfeit'; // 부전승일 때 서버가 보낸 점수는 신뢰할 수 없어 화면의 점수를 쓴다
    const note = forfeit ? '상대가 돌아오지 않아 승리했어요' : r.reason === 'timeLimit' ? '대결 시간이 끝났어요' : '';
    matchUi.showMatchResult(r.outcome, forfeit ? mine!.state.score : r.score, forfeit ? theirs!.score : r.opponentScore, note);
  }
  matchUi.setMatchOver(matchFlow.myEnd !== null, matchFlow.opponentOver !== null);
  matchUi.setMatchNotice(matchFlow.offline ? '재접속 중…' : matchFlow.opponentOffline ? '상대 재접속 대기 중…' : '');
  if (phase === 'idle' && matchFlow.lost) quit(); // 재접속하지 못했다
};

function findMatch(nickname: string): void {
  if (!nickname) return matchUi.showMatchNick('닉네임을 입력하세요.');
  matchNick = nickname;
  if (!matchFlow.find(nickname)) {
    showMatchBackdrop(); // 결과 화면에서 끊긴 경우 대결 배치를 정리한다
    matchUi.showMatchNick('서버에 연결되지 않았어요.');
  }
}
matchUi.onMatchFind(findMatch);

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

// 내 보드에 한 수를 반영하고 연출을 붙인다 (싱글, 대결 공통)
function applyMine(result: MoveResult, dir: Direction): void {
  board.apply(result.events);
  const impact = impactOf(result.events, record);
  record = Math.max(record, impact.merge);
  if (!vfx) return;
  bump(board, dir);
  for (const ev of result.events) {
    if (ev.type !== 'merge') continue;
    const { x, y } = cellCenter(ev.at);
    const boost = impact.record && ev.value === impact.merge ? RECORD_BURST : 1;
    particles.burst(x, y, tileColor(ev.value), (BURST_BASE + 2 * Math.log2(ev.value)) * boost);
  }
  if (impact.shake) shake(shaker, impact.shake);
  if (impact.flash) flash(app.stage, app.screen.width, app.screen.height, tileColor(impact.merge), impact.flash);
}

window.addEventListener('keydown', (e) => {
  const dir = KEYS[e.code];
  if (matchFlow.phase === 'playing') {
    if (!dir || e.repeat) return;
    e.preventDefault();
    const result = matchFlow.input(dir, performance.now());
    if (result) applyMine(result, dir);
    return;
  }
  if (session?.ended) return armIdle();
  if (!dir || !session || e.repeat) return;
  e.preventDefault();
  const result = session.input(dir, performance.now());
  if (result) {
    applyMine(result, dir);
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
  if (act === 'match') matchUi.showMatchNick();
  if (act === 'match-cancel') quit();
  if (act === 'match-again') findMatch(matchNick);
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
  const { width: W, height: H } = app.screen;
  const now = performance.now();
  if (inMatch) {
    // 좌우 절반의 가운데에 같은 크기로. 위쪽에 닉네임/점수가 들어갈 자리를 남긴다
    const half = Math.min(1, (H * 0.7) / BOARD_PX, (W * 0.5 * 0.85) / BOARD_PX);
    world.scale.set(half);
    world.position.set(W * 0.25 - (BOARD_PX * half) / 2, (H - BOARD_PX * half) / 2);
    theirsWorld.scale.set(half);
    theirsWorld.position.set(W * 0.75 - (BOARD_PX * half) / 2, (H - BOARD_PX * half) / 2);
    matchUi.setMatchBoardSize(BOARD_PX * half);
    matchFlow.tick(now);
    const { mine, theirs } = matchFlow;
    if (mine && theirs) {
      const live = matchFlow.phase === 'countdown' || matchFlow.phase === 'playing';
      const meBar = matchFlow.myEnd ? 0 : Math.min(1, Math.max(0, mine.remaining(now) / mine.limit())); // 카운트다운 중에는 100%를 넘지 않게
      matchUi.setMatchHud({
        me: mine.state.score,
        opponent: theirs.score,
        remaining: live ? matchFlow.remaining(now) : 0,
        meBar,
        opponentBar: matchFlow.opponentTime(now),
        countdown: matchFlow.countdown(now),
      });
      if (live) ui.setTime(meBar);
    }
  } else {
    world.scale.set(1);
    world.position.set((W - BOARD_PX) / 2, (H - BOARD_PX) / 2);
  }
  particles.update(app.ticker.deltaMS / 1000);
  // 화면 오른쪽 절반의 가운데에, 창이 작으면 줄여서 놓는다
  const fit = Math.min(1, (H * 0.8) / BOARD_PX, (W * 0.5 * 0.85) / BOARD_PX);
  demoWorld.scale.set(fit);
  demoWorld.position.set(W * 0.75 - (BOARD_PX * fit) / 2, (H - BOARD_PX * fit) / 2);
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
  if (session.tick(now)) return gameOver();
  ui.setTime(Math.max(0, session.remaining(now) / session.limit()));
});

quit();
