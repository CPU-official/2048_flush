import { NICKNAME_MAX } from '../constants';
import type { EndReason } from '../game/session';
import type { RankEntry, RankScope } from '../net/messages';

const root = document.getElementById('ui')!;
root.innerHTML = `
  <div data-id="status" class="status"></div>
  <section data-screen="start" class="start">
    <h1 class="logo">2048</h1>
    <nav class="menu">
      <button data-act="play">게임 플레이</button>
      <button disabled>대결</button>
      <button data-act="ranking" class="ghost">랭킹</button>
      <button data-act="settings" class="ghost" ${window.api ? '' : 'disabled'}>설정</button>
    </nav>
  </section>
  <section data-screen="game" hidden>
    <header class="hud">
      <div><span>최고 점수</span><b data-id="best">--</b></div>
      <div><span>닉네임</span><b data-id="nickname">--</b></div>
      <div class="right"><span data-id="stack" class="stack"></span><b data-id="score" class="score">0</b></div>
    </header>
    <div class="timebar"><i data-id="time"></i></div>
  </section>
  <section data-screen="account" class="popup" hidden>
    <form class="panel" data-id="account">
      <h2>기록 남기기</h2>
      <p data-id="account-score" class="score"></p>
      <input name="nickname" maxlength="${NICKNAME_MAX}" placeholder="닉네임 (${NICKNAME_MAX}자 이내)" autocomplete="off" />
      <input name="password" type="password" inputmode="numeric" maxlength="4" placeholder="비밀번호 (숫자 4자리)" autocomplete="off" />
      <p data-id="account-error" class="error"></p>
      <button>기록하기</button>
      <button type="button" data-act="quit" class="ghost">기록 안 하고 종료</button>
    </form>
  </section>
  <section data-screen="over" class="popup" hidden>
    <div class="panel">
      <h2 data-id="reason"></h2>
      <p data-id="final" class="score"></p>
      <p data-id="note" class="note"></p>
      <button data-act="again">계속 플레이</button>
      <button data-act="ranking" class="ghost">랭킹</button>
      <button data-act="quit" class="ghost">종료</button>
    </div>
  </section>
  <section data-screen="settings" class="popup" hidden>
    <div class="panel wide" data-id="settings"></div>
  </section>
  <section data-screen="ranking" class="popup" hidden>
    <div class="panel wide">
      <nav class="tabs">
        <button data-act="tab-all" class="ghost">전체 순위</button>
        <button data-act="tab-player" class="ghost">개인 기록</button>
      </nav>
      <ol data-id="rank-list" class="rank"></ol>
      <p data-id="rank-message" class="note"></p>
      <button data-act="close-ranking" class="ghost">닫기</button>
    </div>
  </section>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`[data-id="${id}"]`)!;
const vignette = document.getElementById('vignette')!;
const REASON_TEXT: Record<EndReason, string> = { timeout: '시간 초과', stuck: '더 움직일 수 없음' };
const form = el<HTMLFormElement>('account');

// names에 있는 화면만 보이게 한다.
function show(...names: string[]): void {
  for (const s of root.querySelectorAll<HTMLElement>('[data-screen]')) s.hidden = !names.includes(s.dataset.screen!);
}

export function onAction(handler: (act: string) => void): void {
  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act) handler(act);
  });
}

export function onAccountSubmit(handler: (nickname: string, password: string) => void): void {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handler(form.nickname.value.trim(), form.password.value);
  });
}

export function showStart(): void {
  show('start');
  setTime(1);
}

export function showSettings(): void {
  show('start', 'settings');
}

export function showGame(nickname: string | null): void {
  show('game');
  el('nickname').textContent = nickname ?? '--';
  el('best').textContent = '--';
  setScore(0, 0);
  setTime(1);
}

export function setBest(score: number): void {
  el('best').textContent = String(score);
}

// error가 있으면 서버가 거부해 돌아온 것이라 닉네임은 남기고 비밀번호만 비운다.
export function showAccount(score: number, error = ''): void {
  if (error) form.password.value = '';
  else form.reset();
  el('account-score').textContent = String(score);
  setAccountError(error);
  show('game', 'account');
  (error ? form.password : form.nickname).focus();
}

export function setAccountError(text: string): void {
  el('account-error').textContent = text;
}

export function showOver(reason: EndReason, score: number, note: string): void {
  el('reason').textContent = REASON_TEXT[reason];
  el('final').textContent = String(score);
  el('note').textContent = note;
  form.reset(); // 공용 PC라 입력한 닉네임/비밀번호를 화면 밖에도 남기지 않는다
  show('game', 'over');
}

// 랭킹을 닫고 계속 플레이 / 종료 팝업으로 돌아온다 (내용은 그대로 남아 있다).
export function backToOver(): void {
  show('game', 'over');
}

// entries가 없으면 message만 보여 준다. inGame: 게임 오버 팝업에서 열었는지.
export function showRanking(scope: RankScope, entries: RankEntry[], message: string, inGame: boolean): void {
  for (const tab of ['all', 'player']) {
    root.querySelector(`[data-act="tab-${tab}"]`)!.classList.toggle('on', tab === scope);
  }
  el('rank-list').replaceChildren(
    ...entries.map((e, i) => {
      const li = document.createElement('li');
      // 닉네임은 사용자가 입력한 문자열이라 textContent로만 넣는다
      for (const text of [String(i + 1), e.nickname, String(e.score)]) li.appendChild(document.createElement('span')).textContent = text;
      return li;
    }),
  );
  el('rank-message').textContent = message;
  show(inGame ? 'game' : 'start', 'ranking');
}

// 화면 구석의 서버 연결 상태. pending: 오프라인 큐에 쌓인 기록 수.
export function setStatus(connected: boolean, pending: number): void {
  const status = el('status');
  status.classList.toggle('on', connected);
  status.textContent = (connected ? '연결됨' : '끊김') + (pending ? ` · 대기 중 ${pending}건` : '');
}

export function setScore(score: number, gained: number): void {
  el('score').textContent = String(score);
  if (gained === 0) return;
  const stack = el('stack');
  stack.textContent = `+${gained}`;
  stack.style.setProperty('--gain', String(Math.min(1, Math.max(0, (Math.log2(gained) - 2) / 8)))); // 큰 점수일수록 크게 강조
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
