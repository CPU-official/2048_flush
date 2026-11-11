import { DEFAULT_TIMER, RECONNECT_INTERVAL, REQUEST_TIMEOUT } from '../constants';
import type { TimerSettings } from '../game/timer';
import type { ClientMessage, RankEntry, RankError, RankScope, ServerMessage } from './messages';

const TIMER_KEY = 'timer';
// Node(테스트)에는 localStorage가 없다.
const storage: Storage | undefined = globalThis.localStorage;

export class NetClient {
  // 서버가 내려준 마지막 제한 시간 설정. 받은 적이 없으면 초기값.
  timer: TimerSettings = { ...DEFAULT_TIMER, ...JSON.parse(storage?.getItem(TIMER_KEY) ?? '{}') };
  connected = false;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private waiters = new Set<(msg: ServerMessage | null) => void>();

  // address: "IP:포트". 끊기면 disconnect()를 부를 때까지 계속 다시 접속한다.
  connect(address: string): void {
    this.disconnect();
    const socket = (this.socket = new WebSocket(`ws://${address}`));
    socket.onopen = () => (this.connected = true);
    socket.onmessage = (e) => {
      const msg: ServerMessage = JSON.parse(String(e.data));
      if (msg.type === 'config') {
        this.timer = msg.timer;
        storage?.setItem(TIMER_KEY, JSON.stringify(msg.timer));
      }
      for (const waiter of [...this.waiters]) waiter(msg);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return; // disconnect()나 새 connect()로 교체됨
      this.connected = false;
      for (const waiter of [...this.waiters]) waiter(null);
      this.retry = setTimeout(() => this.connect(address), RECONNECT_INTERVAL * 1000);
    };
  }

  disconnect(): void {
    clearTimeout(this.retry);
    const socket = this.socket;
    this.socket = undefined;
    this.connected = false;
    socket?.close();
    for (const waiter of [...this.waiters]) waiter(null);
  }

  // 기록 제출. 반환값: null = 저장됨, 'offline' = 서버에 닿지 못함.
  submit(game: { id: string; nickname: string; password: string; score: number; maxTile: number }): Promise<RankError | 'offline' | null> {
    return this.request({ type: 'rank.submit', ...game }, (msg) =>
      msg.type === 'rank.ack' && msg.id === game.id ? { value: msg.ok ? null : (msg.error ?? 'invalid') } : undefined,
    ).then((r) => (r ? r.value : 'offline'));
  }

  // 랭킹 조회. 서버에 닿지 못하면 null.
  ranking(scope: RankScope, nickname: string | undefined, top: number): Promise<RankEntry[] | null> {
    return this.request({ type: 'rank.get', scope, nickname, top }, (msg) =>
      msg.type === 'rank.list' && msg.scope === scope && msg.nickname === nickname ? { value: msg.entries } : undefined,
    ).then((r) => (r ? r.value : null));
  }

  // pick이 값을 돌려주는 첫 응답을 기다린다. 끊김/시간 초과면 null.
  private request<T>(msg: ClientMessage, pick: (msg: ServerMessage) => T | undefined): Promise<T | null> {
    if (!this.connected || !this.socket) return Promise.resolve(null);
    return new Promise((resolve) => {
      const finish = (value: T | null) => {
        clearTimeout(timeout);
        this.waiters.delete(waiter);
        resolve(value);
      };
      const waiter = (reply: ServerMessage | null) => {
        if (reply === null) return finish(null);
        const picked = pick(reply);
        if (picked !== undefined) finish(picked);
      };
      const timeout = setTimeout(() => finish(null), REQUEST_TIMEOUT * 1000);
      this.waiters.add(waiter);
      this.socket!.send(JSON.stringify(msg));
    });
  }
}
