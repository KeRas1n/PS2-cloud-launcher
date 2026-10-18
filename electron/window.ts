import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import type { LauncherRuntime } from './runtime';
export interface WindowReference {
  current?: BrowserWindow;
}
export function createLauncherWindow(
  windows: WindowReference,
  runtime: LauncherRuntime,
  options: {
    smokeTest: boolean;
    devUrl: string | undefined;
    rendererFile: string;
  },
) {
  const { smokeTest, devUrl, rendererFile } = options;
  const { sync, autoSync, pcsx2, store, session } = runtime;

  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 740,
    minHeight: 600,
    show: !smokeTest,
    backgroundColor: '#0d1017',
    title: 'PS2 Cloud Launcher',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(rendererFile);
  window.on('close', (event) => {
    if (
      runtime.modifying ||
      sync.busy ||
      autoSync.busy ||
      (pcsx2.running && session.cloud && store.value.autoSyncSaves)
    ) {
      event.preventDefault();
      void dialog.showMessageBox(window!, {
        type: 'info',
        message: pcsx2.running
          ? 'Close PCSX2 first so the launcher can synchronize your saves.'
          : 'Wait for the current operation to finish before closing the launcher.',
      });
    }
  });
  window.on('closed', () => {
    windows.current = undefined;
  });

  windows.current = window;
  return window;
}
