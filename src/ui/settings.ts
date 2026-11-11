import { normalizeAddress, type AdminResult, type AppState } from '../net/admin';

type Run = (name: string, ...args: unknown[]) => Promise<AdminResult>;

const panel = document.querySelector<HTMLElement>('[data-id="settings"]')!;
let run: Run;
let test: (address: string) => Promise<boolean>;
let connected = false;

// run: 관리 함수 호출. test: 주소로 접속이 되는지 확인.
export function initSettings(runAdmin: Run, testConnection: (address: string) => Promise<boolean>): void {
  run = runAdmin;
  test = testConnection;
}

export async function openSettings(): Promise<void> {
  render(await run('state'));
}

export function setConnected(value: boolean): void {
  connected = value;
  const el = panel.querySelector('[data-id="conn"]');
  if (el) el.textContent = value ? '연결됨' : '끊김';
}

const input = (name: string) => panel.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const say = (text: string) => (panel.querySelector('[data-id="settings-message"]')!.textContent = text);

function render({ state, message }: AdminResult): void {
  panel.innerHTML = `
    <h2>설정</h2>
    <div class="row"><span>VFX (이 PC)</span><button data-set="vfx" class="ghost">${state.vfx ? '켜짐' : '꺼짐'}</button></div>
    ${state.running ? serverMode(state) : clientMode()}
    <p data-id="settings-message" class="note"></p>
    <button data-act="close-settings" class="ghost">닫기</button>`;
  // 저장된 값은 innerHTML이 아니라 속성으로 넣는다
  if (state.timer) for (const [name] of TIMER_FIELDS) input(name).value = String(state.timer[name]);
  if (!state.running) {
    input('address').value = state.serverAddress;
    input('port').value = String(state.port);
  }
  say(message);
  setConnected(connected);
  panel.onclick = (e) => {
    const action = (e.target as HTMLElement).dataset.set;
    if (action) act(action, state);
  };
}

const TIMER_FIELDS = [
  ['start', '시작값(초)'],
  ['maxReduction', '최대감소값(초)'],
  ['midMove', '중간수'],
  ['steepness', '기울기'],
] as const;

const serverMode = (state: AppState) => `
    <p class="label">서버 실행 중 · 다른 PC의 설정에 이 주소를 입력하세요</p>
    <p class="address">${state.lanAddress}</p>
    <button data-set="stop" class="ghost">서버 중지</button>
    <p class="label">수당 제한 시간 (다음 게임부터 적용)</p>
    ${TIMER_FIELDS.map(([name, label]) => `<div class="row"><span>${label}</span><input name="${name}" inputmode="decimal" autocomplete="off" /></div>`).join('')}
    <button data-set="timer" class="ghost">저장</button>`;

const clientMode = () => `
    <p class="label">서버 주소 (IP:포트)</p>
    <div class="row"><input name="address" placeholder="192.168.0.10:8080" autocomplete="off" /><button data-set="connect" class="ghost">접속</button></div>
    <div class="row"><span>연결 상태: <b data-id="conn"></b></span><button data-set="test" class="ghost">연결 테스트</button></div>
    <p class="label">이 PC를 서버로 쓰기 (포트)</p>
    <div class="row"><input name="port" inputmode="numeric" autocomplete="off" /><button data-set="start" class="ghost">서버 시작</button></div>`;

async function act(action: string, state: AppState): Promise<void> {
  if (action === 'vfx') return render(await run('vfx', !state.vfx));
  if (action === 'timer') {
    // 빈 칸은 Number('')=0이 되므로 NaN으로 바꿔 서버 검증에서 걸리게 한다
    const num = (name: string) => (input(name).value.trim() === '' ? NaN : Number(input(name).value));
    return void say((await run('timer.set', Object.fromEntries(TIMER_FIELDS.map(([name]) => [name, num(name)])))).message);
  }
  if (action === 'stop') return render(await run('server.stop'));
  if (action === 'start') return render(await run('server.start', Number(input('port').value)));
  if (action === 'connect') {
    const address = input('address').value.trim();
    return render(await (address ? run('connect', address) : run('disconnect')));
  }
  if (action === 'test') {
    const address = normalizeAddress(input('address').value);
    if (!address) return void say('서버 주소는 IP 또는 IP:포트 형식이어야 합니다.');
    say(`${address} 확인 중…`);
    say((await test(address)) ? `${address}에 접속할 수 있습니다.` : `${address}에 접속할 수 없습니다.`);
  }
}
