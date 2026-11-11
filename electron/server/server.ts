import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { BACKUP_INTERVAL, DEFAULT_TIMER } from '../../src/constants';
import type { TimerSettings } from '../../src/game/timer';
import type { ClientMessage, ServerMessage } from '../../src/net/messages';
import { listAll, listPlayer, load, save, stamp, submit, toCsv } from './ranking';

export interface RunningServer {
  port: number;
  timer: TimerSettings;
  setTimer(timer: TimerSettings): void; // 저장하고 접속 중인 클라이언트에 다시 보낸다
  users(): string[]; // 등록된 닉네임 (비밀번호는 내보내지 않는다)
  deleteUser(nickname: string): boolean; // 닉네임과 그 기록을 지운다. 없으면 false
  setPassword(nickname: string, password: string): boolean; // 없는 닉네임이면 false
  exportCsv(): string; // 비밀번호 없는 CSV를 dir에 쓰고 파일 경로를 돌려준다
  resetRanking(): string; // 지금 랭킹을 ranking.<시각>.json으로 백업한 뒤 비운다. 백업 경로를 돌려준다
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
        users: () => Object.keys(data.users).sort(),
        deleteUser: (nickname) => {
          if (!Object.hasOwn(data.users, nickname)) return false;
          const { [nickname]: _gone, ...users } = data.users;
          const games = data.games.filter((g) => g.nickname !== nickname);
          save(rankingFile, { users, games }); // 저장이 실패하면 메모리를 바꾸지 않는다
          data.users = users;
          data.games = games;
          return true;
        },
        setPassword: (nickname, password) => {
          if (!Object.hasOwn(data.users, nickname)) return false;
          const users = { ...data.users, [nickname]: password };
          save(rankingFile, { users, games: data.games });
          data.users = users;
          return true;
        },
        exportCsv: () => {
          const file = path.join(dir, `ranking.${stamp(Date.now())}.csv`);
          fs.writeFileSync(file, toCsv(data));
          return file;
        },
        resetRanking: () => {
          let backup = path.join(dir, `ranking.${stamp(Date.now())}.json`);
          for (let n = 1; fs.existsSync(backup); n++) backup = path.join(dir, `ranking.${stamp(Date.now())}-${n}.json`); // 같은 초에 두 번 불러도 앞선 백업을 덮지 않는다
          save(backup, data); // 메모리 기준으로 백업해야 파일과 어긋나지 않는다
          save(rankingFile, { users: {}, games: [] }); // 파일 저장이 실패하면 메모리를 비우지 않는다
          data.users = {};
          data.games = [];
          return backup;
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
