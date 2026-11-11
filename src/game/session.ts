import { createGame, move, type Direction, type GameState, type MoveResult } from '../core/game';
import { GRACE } from '../constants';
import { timeLimit, type TimerSettings } from './timer';

export type EndReason = 'stuck' | 'timeout';

// 한 판의 진행. 시계(ms)는 호출하는 쪽이 넘겨준다.
export class GameSession {
  state: GameState;
  ended: EndReason | null = null;
  private moveStartedAt: number;
  private settings: TimerSettings;

  constructor(seed: number, settings: TimerSettings, now: number) {
    this.settings = { ...settings }; // 바뀐 설정은 다음 게임부터 적용된다
    this.state = createGame(seed);
    this.moveStartedAt = now;
  }

  limit(): number {
    return timeLimit(this.state.moves, this.settings);
  }

  // 이번 수의 남은 시간(초). 유예 구간에서는 음수.
  remaining(now: number): number {
    return this.limit() - (now - this.moveStartedAt) / 1000;
  }

  tick(now: number): EndReason | null {
    if (!this.ended && this.remaining(now) < -GRACE) this.ended = 'timeout';
    return this.ended;
  }

  input(dir: Direction, now: number): MoveResult | null {
    if (this.tick(now)) return null;
    const result = move(this.state, dir);
    if (!result.moved) return null; // 무효 입력은 타이머를 리셋하지 않는다
    this.state = result.state;
    this.moveStartedAt = now;
    if (result.state.over) this.ended = 'stuck';
    return result;
  }
}
