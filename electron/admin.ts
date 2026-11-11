import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTimer, type TimerSettings } from '../src/game/timer';
import { DEFAULT_PORT } from '../src/constants';
import { normalizeAddress, type AdminResult, type AppState } from '../src/net/admin';
import { startServer, type RunningServer } from './server/server';

type Config = Pick<AppState, 'mode' | 'serverAddress' | 'port' | 'vfx'>;

function loadConfig(file: string): Config {
  let saved = {};
  try {
    if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('config.json을 읽지 못해 기본값을 씁니다:', err); // 손으로 고치다 깨져도 창은 열려야 한다
  }
  return { mode: 'client', serverAddress: '', port: DEFAULT_PORT, vfx: true, ...saved };
}

function lanIp(): string {
  const all = Object.values(os.networkInterfaces()).flat();
  return all.find((n) => n && n.family === 'IPv4' && !n.internal)?.address ?? '127.0.0.1';
}

// 관리 함수 모음. 설정 화면 버튼과 슬래시 커맨드가 같은 함수를 부른다 (규칙을 한 곳에만 둔다).
// dir: config.json, ranking.json, server-settings.json이 놓이는 폴더 (Electron userData).
export function createAdmin(dir: string) {
  const file = path.join(dir, 'config.json');
  const config = loadConfig(file);
  let server: RunningServer | null = null;
  let queue: Promise<unknown> = Promise.resolve(); // 명령을 한 번에 하나씩 실행한다 (서버 시작 연타 시 server 변수 경쟁 방지)

  const state = (): AppState => ({
    ...config,
    running: server !== null,
    lanAddress: `${lanIp()}:${server?.port ?? config.port}`,
    users: server?.users() ?? null,
    timer: server?.timer ?? null,
    connectTo: server ? `localhost:${server.port}` : config.serverAddress,
  });
  const done = (ok: boolean, message: string): AdminResult => ({ ok, message, state: state() });
  const save = () => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  };

  const commands: Record<string, (...args: unknown[]) => Promise<AdminResult>> = {
    state: async () => done(true, ''),

    'server.start': async (port = config.port) => {
      if (server) return done(false, '서버가 이미 실행 중입니다.');
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        return done(false, '포트는 1~65535 사이의 숫자여야 합니다.');
      }
      try {
        server = await startServer(port, dir);
      } catch (err) {
        return done(false, `서버를 시작하지 못했습니다: ${(err as Error).message}`);
      }
      config.mode = 'server';
      config.port = port;
      save();
      return done(true, `서버를 시작했습니다. 주소: ${state().lanAddress}`);
    },

    'server.stop': async () => {
      if (!server) return done(false, '실행 중인 서버가 없습니다.');
      await server.stop();
      server = null;
      config.mode = 'client';
      save();
      return done(true, '서버를 중지했습니다.');
    },

    // 대기열/대결 목록은 7번 단계(1대1 대결)가 생기기 전까지 비어 있다
    'server.status': async () => {
      if (!server) return done(false, '서버가 실행 중이 아닙니다.');
      return done(true, `서버 ${state().lanAddress} · 접속자 ${server.clients()}명 · 대기 중 0명 · 진행 중인 대결 없음`);
    },

    'timer.set': async (timer) => {
      if (!server) return done(false, '서버가 실행 중일 때만 바꿀 수 있습니다.');
      const error = validateTimer(timer);
      if (error) return done(false, error);
      const { start, maxReduction, midMove, steepness } = timer as TimerSettings;
      server.setTimer({ start, maxReduction, midMove, steepness });
      return done(true, '제한 시간을 저장했습니다. 다음 게임부터 적용됩니다.');
    },

    'ranking.export': async () => {
      if (!server) return done(false, '서버가 실행 중일 때만 내보낼 수 있습니다.');
      return done(true, `CSV를 저장했습니다: ${server.exportCsv()}`);
    },

    // 확인 절차는 호출하는 쪽(설정 화면, 슬래시 커맨드)이 맡는다. 여기서는 항상 백업 후 실행한다.
    'ranking.reset': async () => {
      if (!server) return done(false, '서버가 실행 중일 때만 초기화할 수 있습니다.');
      return done(true, `랭킹을 초기화했습니다. 백업: ${server.resetRanking()}`);
    },

    'user.delete': async (nickname) => {
      if (!server) return done(false, '서버가 실행 중일 때만 지울 수 있습니다.');
      if (typeof nickname !== 'string' || !server.deleteUser(nickname)) return done(false, `없는 닉네임입니다: ${nickname}`);
      return done(true, `${nickname}과(와) 그 기록을 지웠습니다.`);
    },

    // 메시지에 비밀번호를 넣지 않는다 (화면과 로그에 남기지 않는다)
    'user.password': async (nickname, password) => {
      if (!server) return done(false, '서버가 실행 중일 때만 바꿀 수 있습니다.');
      if (typeof password !== 'string' || !/^\d{4}$/.test(password)) return done(false, '비밀번호는 숫자 4자리여야 합니다.');
      if (typeof nickname !== 'string' || !server.setPassword(nickname, password)) return done(false, `없는 닉네임입니다: ${nickname}`);
      return done(true, `${nickname}의 비밀번호를 바꿨습니다.`);
    },

    connect: async (input) => {
      const address = normalizeAddress(input);
      if (!address) return done(false, '서버 주소는 IP 또는 IP:포트 형식이어야 합니다.');
      config.serverAddress = address;
      save();
      return done(true, server ? `${address}를 저장했습니다. 서버 실행 중에는 이 PC의 서버를 씁니다.` : `${address}에 접속합니다.`);
    },

    disconnect: async () => {
      config.serverAddress = '';
      save();
      return done(true, server ? '서버 주소를 지웠습니다. 서버 실행 중에는 이 PC의 서버를 씁니다.' : '접속을 해제했습니다.');
    },

    vfx: async (on) => {
      config.vfx = on === true;
      save();
      return done(true, `VFX를 ${config.vfx ? '켰습니다' : '껐습니다'}.`);
    },
  };

  return {
    run: (name: string, ...args: unknown[]): Promise<AdminResult> => {
      const result = queue.then(() =>
        Object.hasOwn(commands, name) ? commands[name](...args) : done(false, `알 수 없는 명령입니다: ${name}`),
      );
      queue = result.catch(() => {});
      return result.catch((err) => done(false, `실패했습니다: ${(err as Error).message}`)); // 저장 실패 등
    },
    // 앱 시작 시: 지난번에 서버 모드였으면 서버를 다시 띄운다. 실패해도 창은 열려야 한다.
    init: async (): Promise<void> => {
      if (config.mode !== 'server') return;
      try {
        const result = await commands['server.start'](config.port);
        if (!result.ok) console.error(result.message);
      } catch (err) {
        console.error(err);
      }
    },
  };
}
