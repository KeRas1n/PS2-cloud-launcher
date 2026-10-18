import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Progress } from '../shared/types';
import { SettingsStore } from './services/settings';
import { PCSX2Service } from './services/pcsx2';
import { RcloneService } from './services/rclone';
import { GameService } from './services/games';
import { SyncService } from './services/sync';
import { AutoSyncService, SyncCancelled } from './services/auto-sync';
import { TransferQueue } from './services/transfer-queue';

protocol.registerSchemesAsPrivileged([
  { scheme: 'launcher-cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
let window: BrowserWindow | undefined;
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
    window?.show();
    window?.focus();
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
  const store = new SettingsStore(app.getPath('userData'), launcherDir);
  await store.load();
  const emit = (progress: Progress) => {
    if (window && !window.isDestroyed()) window.webContents.send('progress', progress);
  };
  const pcsx2 = new PCSX2Service(store, emit, () => {
      if (store.value.autoSyncSaves && sessionCloud) {
        // Exit callbacks cannot reject into the process event loop.
        void exclusive(() => autoSync.synchronize()).catch((error) => {
          emit({ operation: 'auto-sync', message: `Cloud saves pending: ${error.message}` });
          if (window && !(error instanceof SyncCancelled))
            void dialog.showMessageBox(window, {
              type: 'warning',
              message: 'Cloud saves have not synchronized.',
              detail: `${error.message}\nLocal saves remain on this device. Retry from Cloud before playing on another device.`,
            });
        });
      } else transfers.wake();
    }),
    rclone = new RcloneService(
      store,
      emit,
      app.isPackaged
        ? path.join(process.resourcesPath, 'cloud', process.platform === 'win32' ? 'rclone.exe' : 'rclone')
        : path.join(
            app.getAppPath(),
            'tools',
            'bundled-rclone',
            process.platform,
            process.platform === 'win32' ? 'rclone.exe' : 'rclone',
          ),
    );
  const games = new GameService(store, rclone),
    sync = new SyncService(store, rclone, games, pcsx2, emit);
  const autoSync = new AutoSyncService(
    store,
    rclone,
    emit,
    async (conflicts) => {
      const result = await dialog.showMessageBox(window!, {
        type: 'question',
        title: 'Save conflicts',
        message: `${conflicts.length} save file(s) changed on both devices.`,
        detail: `${conflicts
          .slice(0, 15)
          .map((f) => `${f.kind}/${f.path}`)
          .join(
            '\n',
          )}\n\nChoose which version to use for these conflicts. Other saves merge automatically. Replaced versions remain in backups.`,
        buttons: ['Cancel', 'Use local saves', 'Use cloud saves'],
        defaultId: 0,
        cancelId: 0,
      });
      return result.response === 1 ? 'upload' : result.response === 2 ? 'download' : undefined;
    },
    () => pcsx2.running,
  );
  let sessionCloud = false;
  let modifying = false;
  const transfers = new TransferQueue(
    (items) => {
      if (window && !window.isDestroyed()) window.webContents.send('transfers', items);
    },
    2,
    (item) => item.kind === 'Games' || (!modifying && !pcsx2.running && !autoSync.busy),
  );
  const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    if (modifying || sync.busy || autoSync.busy)
      throw new Error('Another operation is in progress. Please wait.');
    modifying = true;
    try {
      return await action();
    } finally {
      modifying = false;
      transfers.wake();
    }
  };
  async function enqueueTransfer(planId: unknown, confirmed: unknown) {
    const prepared = sync.detach(z.string().uuid().parse(planId), z.boolean().parse(confirmed));
    const settings = structuredClone(store.value);
    const directory = path.join(store.userData, 'transfer-staging', randomUUID());
    let close: (() => Promise<void>) | undefined;
    try {
      const { client, store: scopedStore } = await rclone.createTransferClient(settings, directory);
      close = () => client.close();
      const scopedGames = new GameService(scopedStore, client);
      scopedGames.games = new Map([...games.games].map(([id, game]) => [id, structuredClone(game)]));
      const request = prepared.request;
      const game = request.gameId ? scopedGames.get(request.gameId) : undefined;
      const root =
        request.kind === 'Games'
          ? settings.downloadDirectory
          : request.kind === 'Memcards'
            ? settings.memcardsDirectory
            : settings.saveStatesDirectory;
      const keys = prepared.plan.files.flatMap((file) => [
        `local:${path.resolve(request.direction === 'upload' && game?.localPath ? game.localPath : path.join(root, file.path)).toLowerCase()}`,
        `remote:${settings.cloudProvider}:${settings.rcloneConfig}:${settings.remote}:${settings.cloudRoot}/${request.kind}/${file.path}`.toLowerCase(),
      ]);
      return transfers.add(
        {
          title: game?.title ?? (request.kind === 'Memcards' ? 'Memory cards' : 'Save states'),
          kind: request.kind,
          direction: request.direction,
          provider: settings.cloudProvider,
          gameId: request.gameId,
          totalBytes: prepared.plan.bytes,
        },
        keys,
        async (signal, progress) => {
          client.setCancellation(signal);
          const worker = new SyncService(scopedStore, client, scopedGames, pcsx2, progress, true, signal);
          worker.adopt(prepared);
          await worker.execute(prepared.plan.id, true);
        },
        async () => {
          await client.close();
          await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        },
      );
    } catch (error) {
      await close?.();
      await fs
        .rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        .catch(() => {});
      throw error;
    }
  }
  function handle(channel: string, callback: (...args: any[]) => unknown) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const url = event.senderFrame?.url;
      const expected = devUrl ? new URL(devUrl).origin : pathToFileURL(rendererFile).href;
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        (devUrl ? !url || new URL(url).origin !== expected : url !== expected)
      )
        throw new Error('Untrusted IPC sender.');
      try {
        return await callback(...args);
      } catch (error) {
        throw new Error(
          error instanceof z.ZodError
            ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
            : (error as Error).message,
        );
      }
    });
  }
  const id = z.string().regex(/^[a-f0-9]{64}$/);
  async function pick(kind: 'directory' | 'executable' | 'bios' | 'cover') {
    const result = await dialog.showOpenDialog(window!, {
      properties: kind === 'directory' ? ['openDirectory', 'createDirectory'] : ['openFile'],
      filters:
        kind === 'cover'
          ? [{ name: 'Cover images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
          : kind === 'bios'
            ? [
                { name: 'BIOS files', extensions: ['bin', 'rom', 'bios'] },
                { name: 'All files', extensions: ['*'] },
              ]
            : [],
    });
    return result.canceled ? null : result.filePaths[0];
  }
  handle('snapshot', async () => {
    const [emulator, cloud] = await Promise.all([pcsx2.status(), rclone.status()]);
    return { settings: store.value, emulator: { ...emulator, running: pcsx2.running }, cloud };
  });
  handle('settings:save', (input) =>
    exclusive(async () => {
      if (pcsx2.running) throw new Error('Close PCSX2 before changing paths.');
      if (input?.cloudProvider !== undefined && input.cloudProvider !== store.value.cloudProvider)
        throw new Error('Use the Cloud storage selector to switch providers.');
      const result = await store.save(input);
      games.games.clear();
      return result;
    }),
  );
  handle('dialog:pick', (kind) => pick(z.enum(['directory', 'executable', 'bios', 'cover']).parse(kind)));
  handle('games:list', () => games.scan());
  const guardDeletion = (gameId: string) => {
    const game = games.get(gameId);
    if (game.localPath && transfers.has(`local:${path.resolve(game.localPath).toLowerCase()}`))
      throw new Error('Cancel this game transfer before deleting its local file.');
    if (
      game.localPath &&
      pcsx2.running &&
      pcsx2.gamePath &&
      path.resolve(game.localPath).toLowerCase() === path.resolve(pcsx2.gamePath).toLowerCase()
    )
      throw new Error('Close this game before deleting its local file.');
  };
  handle('games:delete-preview', async (gameId) => {
    const parsed = id.parse(gameId);
    guardDeletion(parsed);
    return games.prepareDelete(parsed);
  });
  handle('games:delete', (token, confirmed) =>
    exclusive(async () => {
      const parsed = z.string().uuid().parse(token);
      guardDeletion(games.deletionGame(parsed).id);
      await games.deleteLocal(parsed, z.boolean().parse(confirmed));
    }),
  );
  handle('emulator:install', () => exclusive(() => pcsx2.install()));
  handle('emulator:prepare', () => exclusive(() => pcsx2.prepare()));
  handle('emulator:select-bios', (name) =>
    exclusive(() => pcsx2.prepare(z.string().min(1).max(255).parse(name))),
  );
  handle('emulator:open', (gameId) =>
    exclusive(async () => {
      const game = gameId === undefined ? undefined : games.get(id.parse(gameId));
      if (game && !game.localPath) throw new Error('Download this game before playing.');
      if (pcsx2.running) throw new Error('PCSX2 is already running.');
      if (transfers.activeSaves)
        throw new Error('Finish or cancel save synchronization before playing. Game transfers can continue.');
      sessionCloud = false;
      if (game && store.value.autoSyncSaves) {
        // Prepare first: profile migration may select existing populated save folders.
        await pcsx2.prepare();
        const cloud = await rclone.status();
        // A never-connected installation remains fully local without repeated prompts.
        if (cloud.remotes.includes(store.value.remote)) {
          sessionCloud = true;
          try {
            if (!cloud.connected) throw new Error(cloud.error ?? 'Cloud is unavailable.');
            await autoSync.synchronize();
          } catch (error) {
            if (error instanceof SyncCancelled) throw error;
            const result = await dialog.showMessageBox(window!, {
              type: 'warning',
              message: 'Cloud saves could not synchronize.',
              detail: `${(error as Error).message}\nPlaying offline may create conflicts on another device. Local saves remain available.`,
              buttons: ['Cancel', 'Play offline'],
              defaultId: 0,
              cancelId: 0,
            });
            if (result.response !== 1) throw error;
          }
        }
      }
      await pcsx2.launch(game?.localPath);
    }),
  );
  handle('emulator:bios', () =>
    exclusive(async () => {
      if (pcsx2.running) throw new Error('Close PCSX2 before importing BIOS.');
      const file = await pick('bios');
      if (!file) return 0;
      const name = await pcsx2.profiles.importBios(file);
      if ((await pcsx2.status()).installed) await pcsx2.prepare(name);
      return 1;
    }),
  );
  handle('games:cover', (gameId) =>
    exclusive(async () => {
      const game = games.get(id.parse(gameId));
      const file = await pick('cover');
      if (file) await games.setCover(game.id, file);
    }),
  );
  handle('rclone:install', () => exclusive(() => rclone.install()));
  handle('cloud:connect', (input) =>
    exclusive(() => {
      if (pcsx2.running) throw new Error('Close PCSX2 before changing cloud connections.');
      const credentials = z
        .object({
          email: z.string().trim().email().max(320),
          password: z.string().min(1).max(4096),
          code: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
        })
        .strict()
        .optional()
        .parse(input);
      return rclone.connect(credentials);
    }),
  );
  handle('cloud:select', (input) =>
    exclusive(async () => {
      if (pcsx2.running) throw new Error('Close PCSX2 before switching cloud storage.');
      const provider = z.enum(['dropbox', 'mega']).parse(input);
      const settings = await store.selectCloudProvider(provider);
      rclone.dispose();
      games.games.clear();
      return settings;
    }),
  );
  app.on('will-quit', () => rclone.dispose());
  handle('saves:sync', () =>
    exclusive(() => {
      if (transfers.activeSaves) throw new Error('A save transfer is already running.');
      return autoSync.synchronize();
    }),
  );
  handle('transfers:logs', async () => {
    const error = await shell.openPath(await rclone.transferLogDirectory());
    if (error) throw new Error('Could not open transfer logs.');
  });
  handle('sync:plan', (request) => {
    const input = z
      .object({
        kind: z.enum(['Games', 'Memcards', 'SaveStates']),
        direction: z.enum(['upload', 'download']),
        gameId: id.optional(),
      })
      .strict()
      .parse(request);
    return input.kind === 'Games' ? sync.plan(input) : exclusive(() => sync.plan(input));
  });
  handle('sync:enqueue', (planId, confirmed) => exclusive(() => enqueueTransfer(planId, confirmed)));
  handle('sync:execute', async (planId, confirmed) => {
    await exclusive(() => enqueueTransfer(planId, confirmed));
  });
  handle('transfers:list', () => transfers.list());
  handle('transfers:cancel', (id) => transfers.cancel(z.string().uuid().parse(id)));
  handle('sync:cancel', (planId) => sync.cancel(z.string().uuid().parse(planId)));
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void transfers.shutdown().finally(() => app.quit());
  });
  handle('link:open', (link) =>
    shell.openExternal(
      {
        pcsx2: 'https://pcsx2.net/docs/setup/',
        rclone: 'https://rclone.org/install/',
        dropbox: 'https://rclone.org/dropbox/',
        mega: 'https://rclone.org/mega/',
      }[z.enum(['pcsx2', 'rclone', 'dropbox', 'mega']).parse(link)],
    ),
  );
  protocol.handle('launcher-cover', (request) => {
    const url = new URL(request.url),
      match = /^\/([a-f0-9]{64})$/.exec(url.pathname);
    if (url.hostname !== 'cover' || !match) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(store.userData, 'covers', `${match[1]}.img`)).href);
  });
  function createWindow() {
    window = new BrowserWindow({
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
        modifying ||
        sync.busy ||
        autoSync.busy ||
        (pcsx2.running && sessionCloud && store.value.autoSyncSaves)
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
      window = undefined;
    });
  }
  createWindow();
  app.on('activate', () => {
    if (!window) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
