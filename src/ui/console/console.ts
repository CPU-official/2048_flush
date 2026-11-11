import type { AdminResult } from '../../net/admin';
import { parseCommand } from './parse';

const root = document.getElementById('ui')!;
const bar = document.createElement('form');
bar.className = 'console';
bar.hidden = true;
bar.innerHTML = '<input autocomplete="off" spellcheck="false" placeholder="/server start" /><p class="note"></p>';
root.append(bar);
const box = bar.querySelector('input')!;
const note = bar.querySelector('p')!;

// 시작 화면만 보일 때(설정·랭킹 팝업이 없을 때)만 `/`로 연다. 설정 화면의 입력칸에 치는 `/`는 건드리지 않는다.
const visible = (screen: string) => !root.querySelector<HTMLElement>(`[data-screen="${screen}"]`)!.hidden;
const onStart = () => visible('start') && !visible('match-nick') && !visible('settings') && !visible('ranking');
let busy = false;
const close = () => {
  bar.hidden = true;
  box.blur();
};

// run: 설정 화면과 같은 관리 함수 호출
export function initConsole(run: (name: string, ...args: unknown[]) => Promise<AdminResult>): void {
  // 게임 시작, 설정, 랭킹 등 어떤 버튼이든 누르면 닫는다 (게임 중 WASD가 입력창에 들어가는 일을 막는다)
  root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.act) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && bar.hidden && onStart() && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      bar.hidden = false;
      box.value = '/';
      note.textContent = '';
      box.focus();
    } else if (e.key === 'Escape' && !bar.hidden) close();
  });
  bar.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return; // 실행 중 Enter 연타로 같은 명령(예: 초기화)이 두 번 실행되지 않게 한다
    const parsed = parseCommand(box.value);
    if ('say' in parsed) {
      note.textContent = parsed.say;
      return;
    }
    busy = true;
    note.textContent = '실행 중…';
    try {
      note.textContent = (await run(...parsed.call)).message;
      box.value = '/';
    } catch (err) {
      note.textContent = `실패했습니다: ${(err as Error).message}`;
    } finally {
      busy = false;
    }
  });
}
