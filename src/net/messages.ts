import type { TimerSettings } from '../game/timer';

// 서버와 클라이언트가 공유하는 메시지 타입 (docs/networking.md "메시지 프로토콜").
export interface RankEntry {
  nickname: string;
  score: number;
  maxTile: number;
  at: number;
}

export type RankScope = 'all' | 'player';
export type RankError = 'password' | 'invalid';

export type ClientMessage =
  | { type: 'rank.submit'; id: string; nickname: string; password: string; score: number; maxTile: number }
  | { type: 'rank.get'; scope: RankScope; nickname?: string; top: number };

export type ServerMessage =
  | { type: 'config'; timer: TimerSettings }
  | { type: 'rank.ack'; id: string; ok: boolean; error?: RankError }
  | { type: 'rank.list'; scope: RankScope; nickname?: string; entries: RankEntry[] };
