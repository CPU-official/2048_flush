import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  serverAddress: (): Promise<string> => ipcRenderer.invoke('server-address'),
});
