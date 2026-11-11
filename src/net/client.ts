import { DEFAULT_TIMER, RECONNECT_INTERVAL, REQUEST_TIMEOUT } from '../constants';
import type { TimerSettings } from '../game/timer';
import type { ClientMessage, RankEntry, RankError, RankScope, ServerMessage } from './messages';

const TIMER_KEY = 'timer';
const QUEUE_KEY = 'queue';

export interface Submission {
  id: string;
  nickname: string;
  password: string;
  score: number;
  maxTile: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

// 저장된 값이 깨져 있어도 앱은 떠야 한다.
function read(storage: Store | undefined, key: string): unknown {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

// 연결 테스트: 주소로 접속이 되는지만 확인하고 바로 닫는다.
export function testConnection(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://${address}`);
    } catch {
      return resolve(false);
    }
    const finish = (ok: boolean) => {
      clearTimeout(timeout);
      socket.onopen = socket.onerror = null;
      socket.close();
      resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), REQUEST_TIMEOUT * 1000);
    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false);
  });
}

export class NetClient {
  // 서버가 내려준 마지막 제한 시간 설정. 받은 적이 없으면 초기값.
  timer: TimerSettings;
  // 오프라인 큐: 서버에 보내지 못한 기록. 앱을 껐다 켜도 남는다.
  queue: Submission[];
  connected = false;
  // 연결 상태나 대기 건수가 바뀔 때 불린다.
  onChange = (): void => {};
  private flushing = false;
  private flushRetry?: ReturnType<typeof setTimeout>;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private waiters = new Set<(msg: ServerMessage | null) => void>();

  // storage: Node(테스트)에는 localStorage가 없어 메모리에만 둔다.
  constructor(private storage: Store | undefined = globalThis.localStorage) {
    this.timer = { ...DEFAULT_TIMER, ...(read(storage, TIMER_KEY) as Partial<TimerSettings> | null) };
    const queue = read(storage, QUEUE_KEY);
    this.queue = Array.isArray(queue) ? queue : [];
  }

  // address: "IP:포트". 끊기면 disconnect()를 부를 때까지 계속 다시 접속한다.
  connect(address: string): void {
    this.disconnect();
    const socket = (this.socket = new WebSocket(`ws://${address}`));
    socket.onopen = () => {
      this.connected = true;
      this.onChange();
      void this.flush();
    };
    socket.onmessage = (e) => {
      const msg: ServerMessage = JSON.parse(String(e.data));
      if (msg.type === 'config') {
        this.timer = msg.timer;
        this.storage?.setItem(TIMER_KEY, JSON.stringify(msg.timer));
      }
      for (const waiter of [...this.waiters]) waiter(msg);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return; // disconnect()나 새 connect()로 교체됨
      this.connected = false;
      this.onChange();
      for (const waiter of [...this.waiters]) waiter(null);
      this.retry = setTimeout(() => this.connect(address), RECONNECT_INTERVAL * 1000);
    };
  }

  disconnect(): void {
    clearTimeout(this.retry);
    clearTimeout(this.flushRetry);
    const socket = this.socket;
    this.socket = undefined;
    this.connected = false;
    socket?.close();
    this.onChange();
    for (const waiter of [...this.waiters]) waiter(null);
  }

  private setQueue(queue: Submission[]): void {
    this.queue = queue;
    try {
      this.storage?.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (err) {
      console.warn('큐를 저장하지 못했습니다 (메모리에만 유지):', err);
    }
    this.onChange();
  }

  // 큐에 쌓인 기록을 순서대로 보낸다. 게임 id 덕분에 다시 보내도 중복 저장되지 않는다.
  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    clearTimeout(this.flushRetry);
    try {
      while (this.connected && this.queue.length) {
        const game = this.queue[0];
        const error = await this.send(game);
        if (error === 'offline') break;
        // 오프라인 중 다른 PC에서 같은 닉네임이 먼저 등록된 경우 등. 다시 보내도 소용없으니 버린다
        if (error) console.warn(`대기 중이던 기록을 서버가 거부해 버립니다 (${error}):`, game.nickname, game.score);
        this.setQueue(this.queue.filter((g) => g.id !== game.id));
      }
    } finally {
      this.flushing = false;
    }
    // 접속은 살아 있는데 응답만 못 받은 경우: 재접속 이벤트가 없으니 직접 다시 시도한다
    if (this.connected && this.queue.length) {
      this.flushRetry = setTimeout(() => void this.flush(), RECONNECT_INTERVAL * 1000);
    }
  }

  // 기록 제출. 반환값: null = 저장됨, 'offline' = 서버에 닿지 못해 큐에 넣음(재접속 시 자동 전송).
  async submit(game: Submission): Promise<RankError | 'offline' | null> {
    const error = await this.send(game);
    if (error === 'offline' && !this.queue.some((g) => g.id === game.id)) this.setQueue([...this.queue, game]);
    void this.flush(); // 접속돼 있으면 큐에 남은 항목을 이어서 보낸다
    return error;
  }

  private send(game: Submission): Promise<RankError | 'offline' | null> {
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
