import { contextBridge, ipcRenderer } from 'electron';
import type { LauncherAPI, Progress } from '../shared/types';
const api: LauncherAPI = {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  pick: (kind) => ipcRenderer.invoke('dialog:pick', kind),
  library: () => ipcRenderer.invoke('games:list'),
  installEmulator: () => ipcRenderer.invoke('emulator:install'),
  prepareEmulator: () => ipcRenderer.invoke('emulator:prepare'),
  selectBios: (name) => ipcRenderer.invoke('emulator:select-bios', name),
  openEmulator: (id) => ipcRenderer.invoke('emulator:open', id),
  importBios: () => ipcRenderer.invoke('emulator:bios'),
  setCover: (id) => ipcRenderer.invoke('games:cover', id),
  installRclone: () => ipcRenderer.invoke('rclone:install'),
  connectCloud: (credentials) => ipcRenderer.invoke('cloud:connect', credentials),
  selectCloudProvider: (provider) => ipcRenderer.invoke('cloud:select', provider),
  syncSaves: () => ipcRenderer.invoke('saves:sync'),
  openTransferLogs: () => ipcRenderer.invoke('transfers:logs'),
  planSync: (request) => ipcRenderer.invoke('sync:plan', request),
  executeSync: (id, confirmed) => ipcRenderer.invoke('sync:execute', id, confirmed),
  cancelPlan: (id) => ipcRenderer.invoke('sync:cancel', id),
  openLink: (link) => ipcRenderer.invoke('link:open', link),
  onProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Progress) => callback(progress);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
};
contextBridge.exposeInMainWorld('launcher', api);
