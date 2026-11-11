import type { Direction } from '../core/game';
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

// 1대1 대결 (docs/networking.md "메시지 프로토콜")
export type GameOverReason = 'stuck' | 'timeout' | 'matchTime';
export type MatchOutcome = 'win' | 'lose' | 'draw';
export type ResultReason = 'normal' | 'timeLimit' | 'forfeit';

export type ClientMessage =
  | { type: 'match.find'; nickname: string }
  | { type: 'match.cancel' }
  | { type: 'move'; dir: Direction; turn: number }
  | { type: 'gameover'; score: number; maxTile: number; reason: GameOverReason }
  | { type: 'rank.submit'; id: string; nickname: string; password: string; score: number; maxTile: number }
  | { type: 'rank.get'; scope: RankScope; nickname?: string; top: number };

export type ServerMessage =
  | { type: 'match.found'; id: string; opponent: string; slot: 0 | 1 }
  | { type: 'start'; id: string; seed: number; startIn: number; timer: TimerSettings; timeLimit: number } // startIn: 시작까지 남은 ms, timeLimit: 대결 시간 상한(초)
  | { type: 'move'; dir: Direction; turn: number }
  | { type: 'match.timeup' }
  | { type: 'opponent.over'; score: number; reason: GameOverReason }
  | { type: 'result'; outcome: MatchOutcome; score: number; opponentScore: number; reason: ResultReason }
  | { type: 'config'; timer: TimerSettings }
  | { type: 'rank.ack'; id: string; ok: boolean; error?: RankError }
  | { type: 'rank.list'; scope: RankScope; nickname?: string; entries: RankEntry[] };
