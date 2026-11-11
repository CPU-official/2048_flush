import { NICKNAME_MAX } from '../constants';
import { diffText } from '../game/match';
import { show } from './ui';

// 대결 화면의 DOM (docs/overview-project.md "대결 화면"). 닉네임 입력/대기 팝업, 대결 HUD, 결과 팝업.
// 상대 닉네임은 사용자가 입력한 문자열이라 textContent로만 넣는다.
const root = document.getElementById('ui')!;
const section = document.createElement('div');
section.innerHTML = `
  <section data-screen="match-nick" class="popup" hidden>
    <form class="panel" data-id="match-form">
      <h2>대결</h2>
      <input name="nickname" maxlength="${NICKNAME_MAX}" placeholder="닉네임 (${NICKNAME_MAX}자 이내)" autocomplete="off" />
      <p data-id="match-message" class="error"></p>
      <button data-id="match-go">상대 찾기</button>
      <button type="button" data-act="match-cancel" class="ghost">취소</button>
    </form>
  </section>
  <section data-screen="match" hidden>
    <div class="mside left"><span data-id="m-me-name"></span><b data-id="m-me-score" class="score">0</b><em data-id="m-me-over"></em></div>
    <div class="mside right"><span data-id="m-op-name"></span><b data-id="m-op-score" class="score">0</b><em data-id="m-op-over"></em></div>
    <div class="mmid"><b data-id="m-diff">0</b><span data-id="m-time"></span></div>
    <div class="mbar left"><i data-id="m-me-bar"></i></div>
    <div class="mbar right"><i data-id="m-op-bar"></i></div>
    <div class="countdown" data-id="m-count" hidden></div>
  </section>
  <section data-screen="match-result" class="popup" hidden>
    <div class="panel">
      <h2 data-id="m-outcome"></h2>
      <p data-id="m-scores" class="note"></p>
      <p data-id="m-note" class="note"></p>
      <button data-act="match-again">다시 대결 찾기</button>
      <button data-act="quit" class="ghost">시작 화면</button>
    </div>
  </section>`;
root.append(...section.children);

const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`[data-id="${id}"]`)!;
const form = el<HTMLFormElement>('match-form');
const input = form.querySelector('input')!;

export function onMatchFind(handler: (nickname: string) => void): void {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handler(input.value.trim());
  });
}

// 닉네임 입력 팝업 (시작 화면 위)
export function showMatchNick(error = ''): void {
  setWaiting(false);
  el('match-message').textContent = error;
  show('start', 'match-nick');
  input.focus();
}

// "대기 중…" (취소 가능). 입력창은 숨긴다.
export function showMatchWaiting(): void {
  setWaiting(true);
  show('start', 'match-nick');
}

function setWaiting(waiting: boolean): void {
  input.hidden = waiting;
  el('match-go').hidden = waiting;
  el('match-message').className = waiting ? 'note' : 'error';
  if (waiting) el('match-message').textContent = '상대를 기다리는 중…';
}

export function clearMatchNick(): void {
  form.reset();
}

export function showMatchGame(me: string, opponent: string): void {
  el('m-me-name').textContent = me;
  el('m-op-name').textContent = opponent;
  for (const id of ['m-me-over', 'm-op-over']) el(id).textContent = '';
  setMatchHud({ me: 0, opponent: 0, remaining: 0, meBar: 1, opponentBar: 1, countdown: 0 });
  show('match');
}

export interface MatchHud {
  me: number; // 내 점수
  opponent: number; // 상대 점수
  remaining: number; // 남은 대결 시간(초)
  meBar: number; // 시간 바 비율 0~1
  opponentBar: number;
  countdown: number; // 카운트다운 남은 초. 0이면 숨긴다
}

export function setMatchHud(h: MatchHud): void {
  el('m-me-score').textContent = String(h.me);
  el('m-op-score').textContent = String(h.opponent);
  el('m-diff').textContent = diffText(h.me, h.opponent);
  const sec = Math.max(0, Math.ceil(h.remaining));
  el('m-time').textContent = h.remaining > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '';
  el('m-me-bar').style.width = `${h.meBar * 100}%`;
  el('m-op-bar').style.width = `${h.opponentBar * 100}%`;
  const count = el('m-count');
  count.hidden = h.countdown <= 0;
  count.textContent = String(Math.ceil(h.countdown));
}

// 끝났으면 "종료"를 표시한다 (내 쪽, 상대 쪽)
export function setMatchOver(me: boolean, opponent: boolean): void {
  el('m-me-over').textContent = me ? '종료' : '';
  el('m-op-over').textContent = opponent ? '종료' : '';
}

export function showMatchResult(outcome: 'win' | 'lose' | 'draw', me: number, opponent: number, note: string): void {
  el('m-outcome').textContent = { win: '승리!', lose: '패배', draw: '무승부' }[outcome];
  el('m-scores').textContent = `내 점수 ${me} · 상대 점수 ${opponent}`;
  el('m-note').textContent = note;
  show('match', 'match-result');
}

// 보드 크기(px)에 맞춰 HUD 위치를 잡는다. 대결 화면이 보일 때 매 프레임 불린다.
export function setMatchBoardSize(px: number): void {
  document.documentElement.style.setProperty('--match-board', `${px}px`);
}
