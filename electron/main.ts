import { app, BrowserWindow } from 'electron';
import path from 'node:path';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 800, backgroundColor: '#0c0c0c' });
  win.setMenuBarVisibility(false);
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
});

app.on('window-all-closed', () => app.quit());
