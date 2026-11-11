import type { EndReason } from '../game/session';

const root = document.getElementById('ui')!;
root.innerHTML = `
  <section class="start">
    <h1 class="logo">2048</h1>
    <nav class="menu">
      <button data-act="play">게임 플레이</button>
      <button disabled>대결</button>
      <button disabled>랭킹</button>
      <button disabled>설정</button>
    </nav>
  </section>
  <section class="game" hidden>
    <header class="hud">
      <div><span>최고 점수</span><b data-id="best">--</b></div>
      <div><span>닉네임</span><b data-id="nickname">--</b></div>
      <div class="right"><span data-id="stack" class="stack"></span><b data-id="score" class="score">0</b></div>
    </header>
    <div class="timebar"><i data-id="time"></i></div>
  </section>
  <section class="popup" hidden>
    <div class="panel">
      <h2 data-id="reason"></h2>
      <p data-id="final" class="score"></p>
      <button data-act="again">계속 플레이</button>
      <button data-act="quit" class="ghost">종료</button>
    </div>
  </section>`;

const el = (id: string) => root.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const section = (name: string) => root.querySelector<HTMLElement>(`.${name}`)!;
const vignette = document.getElementById('vignette')!;
const REASON_TEXT: Record<EndReason, string> = { timeout: '시간 초과', stuck: '더 움직일 수 없음' };

export function onAction(handler: (act: string) => void): void {
  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act) handler(act);
  });
}

export function showStart(): void {
  section('start').hidden = false;
  section('game').hidden = true;
  section('popup').hidden = true;
  setTime(1);
}

export function showGame(): void {
  section('start').hidden = true;
  section('game').hidden = false;
  section('popup').hidden = true;
  setScore(0, 0);
  setTime(1);
}

export function showPopup(reason: EndReason, score: number): void {
  el('reason').textContent = REASON_TEXT[reason];
  el('final').textContent = String(score);
  section('popup').hidden = false;
}

export function setScore(score: number, gained: number): void {
  el('score').textContent = String(score);
  if (gained === 0) return;
  const stack = el('stack');
  stack.textContent = `+${gained}`;
  stack.classList.remove('pop');
  void stack.offsetWidth; // 리플로를 일으켜 같은 애니메이션을 다시 시작한다
  stack.classList.add('pop');
}

// ratio: 남은 시간 비율 1(가득) ~ 0(끝)
export function setTime(ratio: number): void {
  el('time').style.width = `${ratio * 100}%`;
  const danger = 1 - ratio;
  vignette.style.background = `radial-gradient(ellipse at center, transparent 45%, rgba(${Math.round(255 * danger)}, 0, ${Math.round(30 * danger)}, ${0.25 + 0.55 * danger}) 100%)`;
}
