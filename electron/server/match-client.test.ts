import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Direction } from '../../src/core/game';
import { Match } from '../../src/game/match';
import { NetClient } from '../../src/net/client';
import { startServer, type RunningServer } from './server';

// 실제 서버 + NetClient + Match 둘로 대결을 끝까지 진행하는 통합 테스트. 시계는 직접 정한다.
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 600 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};
const DIRS: Direction[] = ['left', 'up', 'right', 'down'];

let dir: string;
let server: RunningServer;
let now: number;
const clients: NetClient[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '2048-mc-'));
  now = 0;
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function join(nickname: string) {
  const net = new NetClient(undefined);
  clients.push(net);
  const match = new Match(net);
  net.onMatch = (msg) => match.handle(msg, now);
  net.connect(`localhost:${server.port}`);
  await until(() => net.connected);
  match.find(nickname);
  return match;
}
// 한 번 입력한다 (보드가 변하는 방향을 순서대로 시도)
const step = (m: Match, turn: number) => {
  for (let i = 0; i < 4; i++) if (m.input(DIRS[(turn + i) % 4], now)) return true;
  return false;
};

describe('대결 (서버 + 클라이언트)', () => {
  it('두 클라이언트가 같은 시드로 시작하고, 서로의 입력이 상대 보드에 재생되며, 끝나면 같은 결과를 받는다', async () => {
    server = await startServer(0, dir);
    const [a, b] = [await join('kim'), await join('lee')];
    await until(() => a.phase === 'countdown' && b.phase === 'countdown');
    expect(a.opponent).toBe('lee');
    expect(b.opponent).toBe('kim');
    expect(a.mine!.state).toEqual(b.mine!.state); // 같은 시드

    now = 3000;
    a.tick(now);
    b.tick(now);
    expect([a.phase, b.phase]).toEqual(['playing', 'playing']);

    // 번갈아 50수. 한 수마다 상대 화면의 보드가 내 보드와 같아진다.
    for (let turn = 0; turn < 50; turn++) {
      step(a, turn);
      await until(() => JSON.stringify(b.theirs) === JSON.stringify(a.mine!.state));
      step(b, turn + 1);
      await until(() => JSON.stringify(a.theirs) === JSON.stringify(b.mine!.state));
    }
    expect(b.theirs).toEqual(a.mine!.state);
    expect(a.theirs).toEqual(b.mine!.state);

    // 둘 다 막힐 때까지 둔다
    for (let turn = 0; (!a.myEnd || !b.myEnd) && turn < 5000; turn++) {
      if (!a.myEnd) step(a, turn);
      if (!b.myEnd) step(b, turn);
    }
    expect([a.myEnd, b.myEnd]).toEqual(['stuck', 'stuck']);
    await until(() => a.phase === 'finished' && b.phase === 'finished');
    const [sa, sb] = [a.mine!.state.score, b.mine!.state.score];
    expect(a.result).toEqual({ outcome: sa > sb ? 'win' : sa < sb ? 'lose' : 'draw', score: sa, opponentScore: sb, reason: 'normal' });
    expect(b.result).toEqual({ outcome: sb > sa ? 'win' : sb < sa ? 'lose' : 'draw', score: sb, opponentScore: sa, reason: 'normal' });
    expect(a.opponentOver?.score ?? sb).toBe(sb);
  });

  it('결과를 받은 뒤 다시 찾으면 새 대결이 열린다', async () => {
    server = await startServer(0, dir);
    const [a, b] = [await join('kim'), await join('lee')];
    await until(() => a.phase === 'countdown' && b.phase === 'countdown');
    now = 3000;
    a.tick(now);
    b.tick(now);
    a.handle({ type: 'match.timeup' }, now); // 시간 상한: 양쪽이 현재 점수로 gameover(matchTime)
    b.handle({ type: 'match.timeup' }, now);
    await until(() => a.phase === 'finished' && b.phase === 'finished');
    expect(a.result).toMatchObject({ outcome: 'draw', reason: 'normal' }); // 서버가 timeup을 보낸 게 아니라 로컬 처리라 normal
    expect(a.find('kim') && b.find('lee')).toBe(true);
    await until(() => a.phase === 'countdown' && b.phase === 'countdown');
    expect(a.mine!.state).toEqual(b.mine!.state);
  });
});
