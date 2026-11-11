import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { createAdmin } from './admin';

app.whenReady().then(async () => {
  const admin = createAdmin(app.getPath('userData'));
  await admin.init();
  ipcMain.handle('admin', (_event, name: string, ...args: unknown[]) => admin.run(name, ...args));

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
