import { contextBridge, ipcRenderer } from 'electron';

// 관리 함수(electron/admin.ts) 호출 하나만 노출한다.
contextBridge.exposeInMainWorld('api', {
  admin: (name: string, ...args: unknown[]) => ipcRenderer.invoke('admin', name, ...args),
});
