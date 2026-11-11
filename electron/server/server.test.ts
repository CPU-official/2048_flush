import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMER } from '../../src/constants';
import { NetClient } from '../../src/net/client';
import { listAll, listPlayer, load, save, submit, type RankingData } from './ranking';
import { startServer, type RunningServer } from './server';

const game = (id: string, nickname: string, password: string, score: number) => ({ id, nickname, password, score, maxTile: 64 });
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '2048-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ranking', () => {
  const empty = (): RankingData => ({ users: {}, games: [] });

  it('처음 보는 닉네임은 등록하고, 비밀번호가 다르면 거부한다', () => {
    const data = empty();
    expect(submit(data, game('a', '홍길동', '0123', 100), 1)).toBeNull();
    expect(data.users['홍길동']).toBe('0123');
    expect(submit(data, game('b', '홍길동', '9999', 200), 2)).toBe('password');
    expect(submit(data, game('c', '홍길동', '0123', 300), 3)).toBeNull();
    expect(data.games.map((g) => g.id)).toEqual(['a', 'c']);
  });

  it('같은 게임 id는 한 번만 저장하고 성공으로 응답한다', () => {
    const data = empty();
    expect(submit(data, game('a', 'kim', '1111', 100), 1)).toBeNull();
    expect(submit(data, game('a', 'kim', '1111', 100), 2)).toBeNull();
    expect(data.games).toHaveLength(1);
  });

  it('형식이 틀리면 invalid로 거부하고 등록하지 않는다', () => {
    const data = empty();
    expect(submit(data, game('a', '', '1111', 1), 1)).toBe('invalid');
    expect(submit(data, game('a', ' kim', '1111', 1), 1)).toBe('invalid');
    expect(submit(data, game('a', '12345678901', '1111', 1), 1)).toBe('invalid');
    expect(submit(data, game('a', 'kim', '123', 1), 1)).toBe('invalid');
    expect(submit(data, game('a', 'kim', '12a4', 1), 1)).toBe('invalid');
    expect(submit(data, { ...game('a', 'kim', '1111', 1), password: 1234 as never }, 1)).toBe('invalid');
    expect(data).toEqual(empty());
  });

  it('객체 내장 속성 이름도 닉네임으로 쓸 수 있다', () => {
    const data = empty();
    expect(submit(data, game('a', 'toString', '1111', 1), 1)).toBeNull();
    expect(submit(data, game('b', 'toString', '2222', 1), 2)).toBe('password');
  });

  it('전체 순위는 닉네임별 최고 점수 한 줄, 개인 기록은 게임별', () => {
    const data = empty();
    submit(data, game('a', 'kim', '1111', 100), 1);
    submit(data, game('b', 'kim', '1111', 300), 2);
    submit(data, game('c', 'lee', '2222', 200), 3);
    submit(data, game('d', 'park', '3333', 300), 4);
    expect(listAll(data, 10).map((e) => [e.nickname, e.score])).toEqual([['kim', 300], ['park', 300], ['lee', 200]]);
    expect(listAll(data, 2)).toHaveLength(2);
    expect(listPlayer(data, 'kim', 10).map((e) => e.score)).toEqual([300, 100]);
    expect(listPlayer(data, 'nobody', 10)).toEqual([]);
    expect(JSON.stringify([listAll(data, 10), listPlayer(data, 'kim', 10)])).not.toMatch(/1111|password|"id"/);
  });

  it('저장하고 다시 읽으면 같고, tmp 파일이 남지 않는다', () => {
    const file = path.join(dir, 'ranking.json');
    expect(load(file)).toEqual(empty());
    const data = empty();
    submit(data, game('a', '홍길동', '0123', 100), 1);
    save(file, data);
    expect(load(file)).toEqual(data);
    expect(load(file).users['홍길동']).toBe('0123');
    expect(fs.readdirSync(dir)).toEqual(['ranking.json']);
  });
});

describe('서버 + 클라이언트', () => {
  let server: RunningServer;
  let client: NetClient;
  const boot = async () => {
    server = await startServer(0, dir);
    client = new NetClient();
    client.connect(`localhost:${server.port}`);
    await until(() => client.connected);
  };
  afterEach(async () => {
    client?.disconnect();
    await server?.stop();
  });

  it('접속하면 서버 설정의 제한 시간을 받는다', async () => {
    fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ timer: { start: 5 } }));
    await boot();
    await until(() => client.timer.start === 5);
    expect(client.timer).toEqual({ ...DEFAULT_TIMER, start: 5 });
  });

  it('기록 제출, 비밀번호 불일치, 랭킹 조회', async () => {
    await boot();
    expect(await client.submit(game('a', 'kim', '0123', 100))).toBeNull();
    expect(await client.submit(game('a', 'kim', '0123', 100))).toBeNull();
    expect(await client.submit(game('b', 'kim', '9999', 999))).toBe('password');
    expect(await client.submit(game('c', 'x'.repeat(11), '0123', 1))).toBe('invalid');
    expect(await client.submit(game('d', 'lee', '0000', 50))).toBeNull();
    const all = await client.ranking('all', undefined, 10);
    expect(all!.map((e) => [e.nickname, e.score])).toEqual([['kim', 100], ['lee', 50]]);
    expect(await client.ranking('player', 'kim', 10)).toHaveLength(1);
    expect(JSON.stringify(all)).not.toContain('0123');
    expect(load(path.join(dir, 'ranking.json')).games).toHaveLength(2);
  });

  it('서버를 다시 띄워도 기록이 남아 있다', async () => {
    await boot();
    await client.submit(game('a', 'kim', '0123', 100));
    client.disconnect();
    await server.stop();
    await boot();
    expect((await client.ranking('all', undefined, 10))!.map((e) => e.score)).toEqual([100]);
    expect(await client.submit(game('b', 'kim', '1111', 1))).toBe('password');
  });

  it('잘못된 메시지를 받아도 서버가 계속 동작한다', async () => {
    await boot();
    const raw = new WebSocket(`ws://localhost:${server.port}`);
    await new Promise((r) => (raw.onopen = r));
    for (const bad of ['null', '[]', '5', '{bad', '{"type":"rank.submit"}', '{"type":"rank.get"}', '{"type":"nope"}']) raw.send(bad);
    raw.close();
    expect(await client.submit(game('a', 'kim', '0123', 100))).toBeNull();
    expect(await client.ranking('all', undefined, 10)).toHaveLength(1);
  });

  it('데이터 파일이 깨져 있으면 시작이 reject된다 (동기 예외 아님)', async () => {
    fs.writeFileSync(path.join(dir, 'ranking.json'), '{bad');
    await expect(startServer(0, dir)).rejects.toThrow();
  });

  it('서버에 닿지 못하면 offline / null을 돌려준다', async () => {
    await boot();
    client.disconnect();
    expect(await client.submit(game('a', 'kim', '0123', 100))).toBe('offline');
    expect(await client.ranking('all', undefined, 10)).toBeNull();
  });
});
