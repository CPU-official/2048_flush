import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORT } from '../src/constants';
import { startServer } from './server/server';

// 이 PC 설정 (userData/config.json, docs/networking.md "설정 저장").
interface AppConfig {
  mode: 'client' | 'server';
  serverAddress: string;
  port: number;
  vfx: boolean;
}

function loadConfig(): AppConfig {
  const file = path.join(app.getPath('userData'), 'config.json');
  let saved = {};
  try {
    if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('config.json을 읽지 못해 기본값을 씁니다:', err); // 손으로 고치다 깨져도 창은 열려야 한다
  }
  return { mode: 'client', serverAddress: '', port: DEFAULT_PORT, vfx: true, ...saved };
}

app.whenReady().then(async () => {
  const config = loadConfig();
  if (config.mode === 'server') {
    // 포트 충돌이나 깨진 데이터 파일로 서버가 못 떠도 싱글 플레이는 되게 창은 연다
    await startServer(config.port, app.getPath('userData')).catch((err) => console.error('서버 시작 실패:', err));
  }
  // 서버 모드 PC는 자기 서버에 localhost로 접속한다
  ipcMain.handle('server-address', () => (config.mode === 'server' ? `localhost:${config.port}` : config.serverAddress));

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0c0c0c',
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.mjs') },
  });
  win.setMenuBarVisibility(false);
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
});

app.on('window-all-closed', () => app.quit());
