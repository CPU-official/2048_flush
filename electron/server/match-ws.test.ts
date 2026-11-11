import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../../src/net/messages';
import { startServer, type RunningServer } from './server';

// 실제 ws 연결로 두 사람이 대결을 끝까지 진행하는 통합 테스트
let dir: string;
let server: RunningServer;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '2048-match-'));
  server = await startServer(0, dir);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function player() {
  const ws = new WebSocket(`ws://localhost:${server.port}`);
  sockets.push(ws);
  const inbox: ServerMessage[] = [];
  ws.on('message', (raw) => inbox.push(JSON.parse(String(raw))));
  await new Promise((resolve) => ws.once('open', resolve));
  return {
    inbox,
    send: (msg: ClientMessage) => ws.send(JSON.stringify(msg)),
    next: async (type: ServerMessage['type']) => {
      for (let i = 0; i < 300; i++) {
        const at = inbox.findIndex((m) => m.type === type);
        if (at >= 0) return inbox.splice(at, 1)[0];
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`${type} 메시지가 오지 않았다`);
    },
  };
}

describe('대결 (ws)', () => {
  it('두 사람이 짝지어져 같은 시드로 시작하고, 입력이 중계되며, 결과가 양쪽에 간다', async () => {
    const [a, b] = [await player(), await player()];
    a.send({ type: 'match.find', nickname: 'kim' });
    for (let i = 0; i < 100 && !server.matchStatus().waiting; i++) await new Promise((r) => setTimeout(r, 10)); // 서버가 받을 때까지
    expect(server.matchStatus()).toEqual({ waiting: 1, matches: [] });
    b.send({ type: 'match.find', nickname: 'lee' });

    expect(await a.next('match.found')).toMatchObject({ opponent: 'lee', slot: 0 });
    expect(await b.next('match.found')).toMatchObject({ opponent: 'kim', slot: 1 });
    const [sa, sb] = [await a.next('start'), await b.next('start')];
    expect(sa).toEqual(sb);
    expect(sa).toMatchObject({ startIn: 3000, timeLimit: 180 });
    expect(server.matchStatus().matches).toEqual([['kim', 'lee']]);

    a.send({ type: 'move', dir: 'left', turn: 0 });
    expect(await b.next('move')).toEqual({ type: 'move', dir: 'left', turn: 0 });
    a.send({ type: 'gameover', score: 400, maxTile: 64, reason: 'stuck' });
    expect(await b.next('opponent.over')).toEqual({ type: 'opponent.over', score: 400, reason: 'stuck' });
    b.send({ type: 'gameover', score: 900, maxTile: 128, reason: 'timeout' });
    expect(await a.next('result')).toEqual({ type: 'result', outcome: 'lose', score: 400, opponentScore: 900, reason: 'normal' });
    expect(await b.next('result')).toEqual({ type: 'result', outcome: 'win', score: 900, opponentScore: 400, reason: 'normal' });
    expect(server.matchStatus().matches).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'ranking.json'))).toBe(false); // 대결은 랭킹에 기록되지 않는다
  });

  it('대기 중에 끊긴 사람은 대기열에서 빠진다', async () => {
    const a = await player();
    a.send({ type: 'match.find', nickname: 'kim' });
    await new Promise((r) => setTimeout(r, 50));
    expect(server.matchStatus().waiting).toBe(1);
    sockets[0].terminate();
    for (let i = 0; i < 100 && server.matchStatus().waiting; i++) await new Promise((r) => setTimeout(r, 10));
    expect(server.matchStatus().waiting).toBe(0);
  });

  it('서버를 멈추면 진행 중인 대결도 정리된다', async () => {
    const [a, b] = [await player(), await player()];
    a.send({ type: 'match.find', nickname: 'kim' });
    b.send({ type: 'match.find', nickname: 'lee' });
    await a.next('start');
    await server.stop();
    expect(server.matchStatus()).toEqual({ waiting: 0, matches: [] });
    server = await startServer(0, dir); // afterEach가 다시 stop한다
  });
});
