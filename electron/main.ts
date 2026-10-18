import { app, dialog, protocol } from 'electron';
import path from 'node:path';
import { registerCoverProtocol } from './covers';
import { registerIpc } from './ipc/register';
import { createRuntime } from './runtime';
import { createLauncherWindow, type WindowReference } from './window';
import { createIpcHandler } from './ipc/handle';
import { LauncherUpdateService } from './services/launcher-update';
protocol.registerSchemesAsPrivileged([
  { scheme: 'launcher-cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const windows: WindowReference = {};
const devUrl =
  !app.isPackaged && process.env.VITE_DEV_SERVER_URL === 'http://127.0.0.1:5173'
    ? process.env.VITE_DEV_SERVER_URL
    : undefined;
const rendererFile = path.resolve(__dirname, '../../dist/index.html');
const smokeTest = !app.isPackaged && process.env.PS2_LAUNCHER_SMOKE === '1';
if (smokeTest)
  app.setPath('userData', path.join(app.getAppPath(), 'test-results', `desktop-data-${process.pid}`));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    windows.current?.show();
    windows.current?.focus();
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox('Launcher could not start', (error as Error).message);
      app.quit();
    });
}

async function start() {
  const launcherDir = smokeTest
    ? path.join(app.getPath('userData'), 'launcher')
    : app.isPackaged
      ? path.dirname(process.env.APPIMAGE ?? process.env.PORTABLE_EXECUTABLE_FILE ?? app.getPath('exe'))
      : app.getAppPath();

  const runtime = await createRuntime(launcherDir, windows);
  registerIpc(runtime, windows, devUrl, rendererFile);
  registerCoverProtocol(runtime.store.userData);
  app.on('will-quit', () => runtime.rclone.dispose());
  const { transfers } = runtime;
  let quitting = false;
  app.on('before-quit', (event) => {
    if (runtime.installingUpdate) return;
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void transfers.shutdown().finally(() => app.quit());
  });

  const createWindow = () => createLauncherWindow(windows, runtime, { smokeTest, devUrl, rendererFile });
  let updates: LauncherUpdateService | undefined;
  // NSIS and AppImage support in-place updates. Portable EXE/deb stay manual.
  if (
    app.isPackaged &&
    ((process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE) ||
      (process.platform === 'linux' && process.env.APPIMAGE))
  ) {
    const { autoUpdater } = await import('electron-updater');
    updates = new LauncherUpdateService(
      autoUpdater,
      (state) => {
        if (windows.current && !windows.current.isDestroyed())
          windows.current.webContents.send('launcher-update', state);
      },
      () => runtime.assertUpdateIdle(),
      (action) => runtime.installLauncherUpdate(action),
    );
    autoUpdater.on('error', () => runtime.updateInstallationFailed());
  }
  const handle = createIpcHandler(windows, devUrl, rendererFile);
  handle('launcher-update:state', () => updates?.state ?? { status: 'idle' });
  handle('launcher-update:confirm', () =>
    runtime.request('launcher-update:confirm', () => updates?.confirm()),
  );
  handle('launcher-update:later', () => updates?.later());
  createWindow();
  void updates?.check();
  app.on('activate', () => {
    if (!windows.current) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
