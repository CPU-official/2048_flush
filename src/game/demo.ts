import { createGame, move, type Direction, type GameState, type MoveResult } from '../core/game';

// 시작 화면 데모용 로그: 시드와 이동 방향(l, r, u, d를 이어 붙인 문자열). 앱에는 AI가 없고 미리 기록한 판을 core로 재생한다.
export interface DemoLog {
  seed: number;
  moves: string;
}

const DIRECTION: Record<string, Direction> = { l: 'left', r: 'right', u: 'up', d: 'down' };

export class Demo {
  state: GameState;
  private index = 0;

  constructor(private log: DemoLog) {
    this.state = createGame(log.seed);
  }

  // 다음 수를 두고 결과를 돌려준다. 로그가 끝났으면 null (호출하는 쪽이 잠시 뒤 restart한다).
  next(): MoveResult | null {
    const dir = DIRECTION[this.log.moves[this.index]];
    if (!dir) return null;
    this.index++;
    const result = move(this.state, dir);
    this.state = result.state;
    return result;
  }

  restart(): GameState {
    this.index = 0;
    return (this.state = createGame(this.log.seed));
  }
}
