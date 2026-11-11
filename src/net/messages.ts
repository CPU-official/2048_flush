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

// 재접속한 사람에게 보내는 대결 상태. 두 사람의 입력 로그를 core로 다시 재생하면 두 보드가 복원된다.
export interface MatchSide {
  moves: Direction[]; // 턴 번호는 배열 순서(0부터)
  over: { score: number; reason: GameOverReason } | null; // 이미 끝났으면 최종 점수와 사유
}
export interface MatchRestore {
  id: string;
  slot: 0 | 1;
  opponent: string;
  seed: number;
  timer: TimerSettings;
  timeLimit: number; // 대결 시간 상한(초)
  startIn: number; // 게임 시작까지 남은 ms. 이미 시작했으면 음수(시작한 지 얼마나 지났는지)
  timeUp: boolean; // 시간 상한 알림이 이미 나갔다 (끝나지 않았다면 바로 gameover(matchTime)을 보낸다)
  mine: MatchSide;
  theirs: MatchSide;
}

export type ClientMessage =
  | { type: 'match.find'; nickname: string }
  | { type: 'match.cancel' }
  | { type: 'match.resume'; id: string; slot: 0 | 1 } // 대결 중 끊겼다가 새 연결로 돌아왔다
  | { type: 'move'; dir: Direction; turn: number }
  | { type: 'gameover'; score: number; maxTile: number; reason: GameOverReason }
  | { type: 'rank.submit'; id: string; nickname: string; password: string; score: number; maxTile: number }
  | { type: 'rank.get'; scope: RankScope; nickname?: string; top: number };

export type ServerMessage =
  | { type: 'match.found'; id: string; opponent: string; slot: 0 | 1 }
  | { type: 'start'; id: string; seed: number; startIn: number; timer: TimerSettings; timeLimit: number } // startIn: 시작까지 남은 ms, timeLimit: 대결 시간 상한(초)
  | { type: 'move'; dir: Direction; turn: number }
  | { type: 'match.timeup' }
  | { type: 'opponent.status'; status: 'offline' | 'online' }
  | { type: 'match.restore'; restore: MatchRestore }
  | { type: 'opponent.over'; score: number; reason: GameOverReason }
  | { type: 'result'; outcome: MatchOutcome; score: number; opponentScore: number; reason: ResultReason }
  | { type: 'config'; timer: TimerSettings }
  | { type: 'rank.ack'; id: string; ok: boolean; error?: RankError }
  | { type: 'rank.list'; scope: RankScope; nickname?: string; entries: RankEntry[] };
