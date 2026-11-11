import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMER } from '../constants';
import { createGame, move, type Direction } from '../core/game';
import type { ClientMessage, ServerMessage } from '../net/messages';
import { diffText, Match } from './match';
import { timeLimit } from './timer';

let sent: ClientMessage[];
let online: boolean;
let m: Match;
const START: ServerMessage = { type: 'start', id: '1', seed: 7, startIn: 3000, timer: DEFAULT_TIMER, timeLimit: 180 };

beforeEach(() => {
  sent = [];
  online = true;
  m = new Match({ post: (msg) => online && (sent.push(msg), true) });
});

const begin = () => {
  m.find('kim');
  m.handle({ type: 'match.found', id: '1', opponent: 'lee', slot: 0 }, 1000);
  m.handle(START, 1000);
  m.tick(4000); // 카운트다운 끝
};
// 보드가 변하는 방향을 하나 찾아 입력한다
const play = (now: number) => {
  for (const d of ['left', 'up', 'right', 'down'] as Direction[]) {
    const r = m.input(d, now);
    if (r) return d;
  }
  return null;
};

describe('대기와 시작', () => {
  it('find는 대기열에 넣고, 서버에 닿지 못하면 false', () => {
    online = false;
    expect(m.find('kim')).toBe(false);
    expect(m.phase).toBe('idle');
    online = true;
    expect(m.find('kim')).toBe(true);
    expect(m.phase).toBe('waiting');
    expect(sent).toEqual([{ type: 'match.find', nickname: 'kim' }]);
    expect(m.find('kim')).toBe(false); // 대기 중 중복 find
  });

  it('취소하면 서버에 알리고 처음으로 돌아간다. 끊기면 알리지 않고 돌아간다', () => {
    m.find('kim');
    m.leave();
    expect(sent.at(-1)).toEqual({ type: 'match.cancel' });
    expect(m.phase).toBe('idle');
    m.find('kim');
    sent.length = 0;
    online = false;
    m.disconnected();
    expect(m.phase).toBe('idle');
    expect(sent).toEqual([]); // 끊긴 연결로는 보내지 못한다 (서버가 대기열에서 이미 뺐다)
  });

  it('found와 start를 받으면 카운트다운을 시작하고, 끝나면 playing이 된다', () => {
    m.find('kim');
    m.handle({ type: 'match.found', id: '1', opponent: 'lee', slot: 0 }, 1000);
    expect(m.opponent).toBe('lee');
    m.handle(START, 1000);
    expect(m.phase).toBe('countdown');
    expect(m.mine!.state).toEqual(createGame(7)); // 두 보드가 같은 시드에서 시작한다
    expect(m.theirs).toEqual(createGame(7));
    expect(m.countdown(1000)).toBe(3);
    expect(m.remaining(1000)).toBe(180);
    m.tick(3999);
    expect(m.phase).toBe('countdown');
    m.tick(4000);
    expect(m.phase).toBe('playing');
    expect(m.remaining(4000 + 30_000)).toBe(150);
  });

  it('카운트다운 중의 입력은 무시한다', () => {
    m.find('kim');
    m.handle(START, 0);
    expect(m.input('left', 1000)).toBeNull();
    expect(m.input('up', 1000)).toBeNull();
    expect(sent.filter((s) => s.type === 'move')).toEqual([]);
  });

  it('대결 중이 아닐 때 온 메시지는 무시한다', () => {
    m.handle(START, 0);
    expect(m.phase).toBe('idle');
  });
});

describe('진행', () => {
  it('내 유효한 입력은 서버로 가고, 무효한 입력은 가지 않는다. 턴 번호는 0부터', () => {
    begin();
    const d1 = play(4100)!;
    const d2 = play(4200)!;
    const moves = sent.filter((s) => s.type === 'move');
    expect(moves).toEqual([
      { type: 'move', dir: d1, turn: 0 },
      { type: 'move', dir: d2, turn: 1 },
    ]);
    const before = sent.length;
    const stuckDir = (['left', 'up', 'right', 'down'] as Direction[]).find((d) => !move(m.mine!.state, d).moved);
    if (stuckDir) expect(m.input(stuckDir, 4300)).toBeNull();
    expect(sent.length).toBe(before);
  });

  it('상대 move를 core로 재생해 상대 보드를 만든다. 같은 턴이 다시 오면 무시한다', () => {
    begin();
    const applied: number[] = [];
    m.onOpponentMove = (r) => applied.push(r.gained);
    let mirror = createGame(7);
    const dirs: Direction[] = ['left', 'up', 'right', 'down', 'left', 'up'];
    dirs.forEach((dir, turn) => {
      m.handle({ type: 'move', dir, turn }, 5000);
      mirror = move(mirror, dir).state;
    });
    expect(m.theirs).toEqual(mirror);
    const snapshot = m.theirs;
    m.handle({ type: 'move', dir: 'left', turn: 0 }, 5000); // 중복
    expect(m.theirs).toEqual(snapshot);
  });

  it('보드를 막혀서 끝내면 gameover(stuck)를 한 번만 보낸다', () => {
    begin();
    for (let i = 0; i < 5000 && !m.myEnd; i++) if (!play(4100 + i)) break;
    expect(m.myEnd).toBe('stuck');
    const overs = sent.filter((s) => s.type === 'gameover');
    expect(overs).toEqual([{ type: 'gameover', score: m.mine!.state.score, maxTile: Math.max(...m.mine!.state.board), reason: 'stuck' }]);
    expect(m.input('left', 999999)).toBeNull();
    m.tick(999999);
    expect(sent.filter((s) => s.type === 'gameover')).toHaveLength(1);
  });

  it('수당 제한 시간이 지나면 gameover(timeout)을 보낸다', () => {
    begin();
    m.tick(4000 + (DEFAULT_TIMER.start + 0.2) * 1000);
    expect(m.myEnd).toBe('timeout');
    expect(sent.at(-1)).toMatchObject({ type: 'gameover', score: 0, reason: 'timeout' });
    expect(m.input('left', 4000 + 10_000)).toBeNull();
  });

  it('입력 직전에 시간이 다 됐으면 그 입력은 timeout으로 끝난다', () => {
    begin();
    expect(m.input('left', 4000 + (DEFAULT_TIMER.start + 0.5) * 1000)).toBeNull();
    expect(m.myEnd).toBe('timeout');
  });

  it('match.timeup을 받으면 현재 점수로 gameover(matchTime)을 보내고 입력을 막는다', () => {
    begin();
    play(4100);
    m.handle({ type: 'match.timeup' }, 190_000);
    expect(sent.at(-1)).toMatchObject({ type: 'gameover', reason: 'matchTime', score: m.mine!.state.score });
    expect(m.myEnd).toBe('matchTime');
    expect(m.input('left', 190_100)).toBeNull();
    m.handle({ type: 'match.timeup' }, 190_200); // 한 번만
    expect(sent.filter((s) => s.type === 'gameover')).toHaveLength(1);
  });

  it('상대가 먼저 끝나면 점수를 기억하고, result를 받으면 끝난다', () => {
    begin();
    m.handle({ type: 'opponent.over', score: 400, reason: 'stuck' }, 5000);
    expect(m.opponentOver).toEqual({ score: 400, reason: 'stuck' });
    expect(m.phase).toBe('playing'); // 나는 계속한다
    m.handle({ type: 'result', outcome: 'lose', score: 10, opponentScore: 400, reason: 'normal' }, 6000);
    expect(m.phase).toBe('finished');
    expect(m.result).toEqual({ outcome: 'lose', score: 10, opponentScore: 400, reason: 'normal' });
  });

  it('결과 뒤에 다시 find할 수 있고, 이전 대결 상태는 지워진다', () => {
    begin();
    m.handle({ type: 'result', outcome: 'draw', score: 0, opponentScore: 0, reason: 'normal' }, 5000);
    expect(m.find('kim')).toBe(true);
    expect(m).toMatchObject({ phase: 'waiting', result: null, mine: null, theirs: null, opponentOver: null, myEnd: null });
  });

  it('카운트다운/진행 중의 leave는 무시하고, 대기 중에는 이전 대결의 늦은 result를 무시한다', () => {
    begin();
    sent.length = 0;
    m.leave();
    expect(m.phase).toBe('playing');
    expect(sent).toEqual([]);
    m.handle({ type: 'result', outcome: 'win', score: 1, opponentScore: 0, reason: 'forfeit' }, 5000);
    expect(m.find('kim')).toBe(true); // 결과 뒤에야 다시 찾을 수 있다
    m.handle({ type: 'result', outcome: 'lose', score: 0, opponentScore: 9, reason: 'normal' }, 5100); // 새 대기 중에 온 늦은 메시지
    expect(m.phase).toBe('waiting');
    expect(m.result).toBeNull();
  });

  it('상대 시간 바는 상대 입력이 도착한 시각부터 줄고, 끝나면 0이다', () => {
    begin(); // 시작 시각 4000
    expect(m.opponentTime(4000)).toBe(1);
    expect(m.opponentTime(4000 + 1500)).toBeCloseTo(1 - 1.5 / timeLimit(0, DEFAULT_TIMER), 5);
    m.handle({ type: 'move', dir: 'left', turn: 0 }, 6000);
    const limit = timeLimit(1, DEFAULT_TIMER); // 1수 뒤의 제한 시간
    expect(m.opponentTime(6000)).toBe(1); // 입력이 도착하면 다시 꽉 찬다
    expect(m.opponentTime(6000 + (limit * 1000) / 2)).toBeCloseTo(0.5, 1);
    expect(m.opponentTime(6000 + 100_000)).toBe(0);
    m.handle({ type: 'opponent.over', score: 10, reason: 'stuck' }, 7000);
    expect(m.opponentTime(7000)).toBe(0);
  });

  it('점수 차이는 앞선 쪽(내가 왼쪽, 상대가 오른쪽)을 가리킨다', () => {
    expect(diffText(500, 180)).toBe('◀ +320');
    expect(diffText(180, 500)).toBe('+320 ▶');
    expect(diffText(70, 70)).toBe('0');
  });

  it('상태가 바뀔 때마다 onChange가 불린다', () => {
    let changes = 0;
    m.onChange = () => changes++;
    begin();
    expect(changes).toBe(3); // 대기, 시작(카운트다운), playing
  });
});
