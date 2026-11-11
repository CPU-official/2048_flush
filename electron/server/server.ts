import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { BACKUP_INTERVAL, DEFAULT_TIMER } from '../../src/constants';
import type { TimerSettings } from '../../src/game/timer';
import type { ClientMessage, ServerMessage } from '../../src/net/messages';
import { listAll, listPlayer, load, save, submit } from './ranking';

export interface RunningServer {
  port: number;
  timer: TimerSettings;
  setTimer(timer: TimerSettings): void; // 저장하고 접속 중인 클라이언트에 다시 보낸다
  stop(): Promise<void>;
}

function loadTimer(dir: string): TimerSettings {
  const file = path.join(dir, 'server-settings.json');
  if (!fs.existsSync(file)) return DEFAULT_TIMER;
  return { ...DEFAULT_TIMER, ...JSON.parse(fs.readFileSync(file, 'utf8')).timer };
}

// dir: ranking.json, server-settings.json이 놓이는 폴더 (Electron userData).
// async: 깨진 파일을 읽다 난 오류도 reject로 돌려준다.
export async function startServer(port: number, dir: string): Promise<RunningServer> {
  const rankingFile = path.join(dir, 'ranking.json');
  const data = load(rankingFile);
  let timer = loadTimer(dir);
  const settingsFile = path.join(dir, 'server-settings.json');
  const wss = new WebSocketServer({ port });
  const backup = setInterval(() => {
    if (fs.existsSync(rankingFile)) fs.copyFileSync(rankingFile, path.join(dir, 'ranking.backup.json'));
  }, BACKUP_INTERVAL * 1000);

  wss.on('connection', (socket) => {
    const send = (msg: ServerMessage) => socket.send(JSON.stringify(msg));
    send({ type: 'config', timer });
    socket.on('message', (raw) => {
      // 메시지 하나가 잘못됐다고 행사 중인 서버가 죽으면 안 된다
      try {
        const msg: ClientMessage = JSON.parse(String(raw));
        if (msg.type === 'rank.submit') {
          const error = submit(data, msg, Date.now());
          if (!error) save(rankingFile, data);
          send({ type: 'rank.ack', id: msg.id, ok: !error, ...(error && { error }) });
        } else if (msg.type === 'rank.get') {
          const entries = msg.scope === 'player' ? listPlayer(data, msg.nickname ?? '', msg.top) : listAll(data, msg.top);
          send({ type: 'rank.list', scope: msg.scope, nickname: msg.nickname, entries });
        }
        // 알 수 없는 타입은 무시한다
      } catch (err) {
        console.error('메시지 처리 실패:', err);
      }
    });
  });

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () =>
      resolve({
        port: (wss.address() as { port: number }).port,
        get timer() {
          return timer;
        },
        setTimer: (next) => {
          fs.writeFileSync(settingsFile, JSON.stringify({ timer: next }, null, 2));
          timer = next;
          for (const client of wss.clients) client.send(JSON.stringify({ type: 'config', timer }));
        },
        stop: () => {
          clearInterval(backup);
          for (const client of wss.clients) client.terminate();
          return new Promise((done) => wss.close(() => done()));
        },
      }),
    );
  });
}
