import { DEFAULT_PORT } from '../constants';
import type { TimerSettings } from '../game/timer';

// 관리 함수(electron/admin.ts)와 렌더러가 공유하는 타입. ws 프로토콜과는 별개다.
export interface AppState {
  mode: 'client' | 'server';
  serverAddress: string; // 클라이언트로 접속할 서버 "IP:포트". 없으면 ''
  port: number;
  vfx: boolean;
  running: boolean; // 이 PC에서 서버가 실행 중인가
  lanAddress: string; // 다른 PC가 접속할 이 PC의 "IP:포트"
  timer: TimerSettings | null; // 서버가 쓰는 제한 시간 설정. 서버가 실행 중일 때만 있다
  connectTo: string; // 이 PC의 클라이언트가 접속할 주소. 서버 실행 중이면 localhost
}

export interface AdminResult {
  ok: boolean;
  message: string; // 설정 화면과 슬래시 커맨드에 그대로 보여 준다
  state: AppState;
}

// "ip" 또는 "ip:포트" → "ip:포트". 형식이 틀리면 null.
export function normalizeAddress(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  const address = text.includes(':') ? text : `${text}:${DEFAULT_PORT}`;
  const port = Number(/^[^\s:]+:(\d{1,5})$/.exec(address)?.[1]);
  return port >= 1 && port <= 65535 ? address : null; // 범위 밖 포트는 WebSocket 생성에서 예외가 난다
}
