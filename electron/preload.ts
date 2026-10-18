import { contextBridge, ipcRenderer } from 'electron';
import type { LauncherAPI, Progress } from '../shared/types';
const api: LauncherAPI = {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  resetLauncher: (confirmed) => ipcRenderer.invoke('settings:reset', confirmed),
  pick: (kind) => ipcRenderer.invoke('dialog:pick', kind),
  library: () => ipcRenderer.invoke('games:list'),
  installEmulator: () => ipcRenderer.invoke('emulator:install'),
  prepareEmulator: () => ipcRenderer.invoke('emulator:prepare'),
  selectBios: (name) => ipcRenderer.invoke('emulator:select-bios', name),
  openEmulator: (id) => ipcRenderer.invoke('emulator:open', id),
  importBios: () => ipcRenderer.invoke('emulator:bios'),
  setCover: (id) => ipcRenderer.invoke('games:cover', id),
  prepareDeleteGame: (id) => ipcRenderer.invoke('games:delete-preview', id),
  deleteGame: (token, confirmed) => ipcRenderer.invoke('games:delete', token, confirmed),
  installRclone: () => ipcRenderer.invoke('rclone:install'),
  connectCloud: (credentials) => ipcRenderer.invoke('cloud:connect', credentials),
  selectCloudProvider: (provider) => ipcRenderer.invoke('cloud:select', provider),
  syncSaves: () => ipcRenderer.invoke('saves:sync'),
  openTransferLogs: () => ipcRenderer.invoke('transfers:logs'),
  planSync: (request) => ipcRenderer.invoke('sync:plan', request),
  executeSync: (id, confirmed) => ipcRenderer.invoke('sync:execute', id, confirmed),
  enqueueSync: (id, confirmed) => ipcRenderer.invoke('sync:enqueue', id, confirmed),
  transfers: () => ipcRenderer.invoke('transfers:list'),
  cancelTransfer: (id) => ipcRenderer.invoke('transfers:cancel', id),
  onTransfers: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, items: Parameters<typeof callback>[0]) =>
      callback(items);
    ipcRenderer.on('transfers', listener);
    return () => ipcRenderer.removeListener('transfers', listener);
  },
  cancelPlan: (id) => ipcRenderer.invoke('sync:cancel', id),
  openLink: (link) => ipcRenderer.invoke('link:open', link),
  onProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Progress) => callback(progress);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
};
contextBridge.exposeInMainWorld('launcher', api);
