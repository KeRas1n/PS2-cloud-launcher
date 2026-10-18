import { app, dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Progress } from '../shared/types';
import { AutoSyncService, SyncCancelled } from './services/auto-sync';
import { GameService } from './services/games';
import { PCSX2Service } from './services/pcsx2';
import { RcloneService } from './services/rclone';
import { SettingsStore } from './services/settings';
import { SyncService } from './services/sync';
import { TransferQueue } from './services/transfer-queue';
import { deleteLauncherData, prepareLauncherReset } from './services/reset';

import type { WindowReference } from './window';
export async function createRuntime(launcherDir: string, windows: WindowReference) {
  const store = new SettingsStore(app.getPath('userData'), launcherDir);
  await store.load();
  const emit = (progress: Progress) => {
    if (windows.current && !windows.current.isDestroyed())
      windows.current.webContents.send('progress', progress);
  };
  const pcsx2 = new PCSX2Service(store, emit, () => {
      if (store.value.autoSyncSaves && session.cloud) {
        // Exit callbacks cannot reject into the process event loop.
        void exclusive(() => autoSync.synchronize()).catch((error) => {
          emit({ operation: 'auto-sync', message: `Cloud saves pending: ${error.message}` });
          if (windows.current && !(error instanceof SyncCancelled))
            void dialog.showMessageBox(windows.current, {
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
      const result = await dialog.showMessageBox(windows.current!, {
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
  const session = { cloud: false };
  let modifying = false;
  let resetting = false;
  let requests = 0;
  const transfers = new TransferQueue(
    (items) => {
      if (windows.current && !windows.current.isDestroyed())
        windows.current.webContents.send('transfers', items);
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

  return {
    store,
    pcsx2,
    rclone,
    games,
    sync,
    autoSync,
    transfers,
    exclusive,
    enqueueTransfer,
    session,
    get resetting() {
      return resetting;
    },
    async request<T>(channel: string, action: () => Promise<T> | T): Promise<T> {
      if (resetting) throw new Error('Launcher data is being reset. Please wait.');
      if (channel === 'settings:reset' && requests)
        throw new Error('Wait for the current operation to finish before resetting launcher data.');
      requests++;
      try {
        return await action();
      } finally {
        requests--;
      }
    },
    async resetLauncher() {
      if (pcsx2.running) throw new Error('Close PCSX2 before resetting launcher data.');
      if (transfers.active) throw new Error('Finish or cancel all transfers before resetting launcher data.');
      return exclusive(async () => {
        resetting = true;
        try {
          const targets = await prepareLauncherReset(store.userData, store.value);
          await transfers.clearHistory();
          await rclone.resetSession();
          const browserSession = windows.current?.webContents.session;
          await browserSession?.clearCache();
          await browserSession?.clearStorageData();
          await deleteLauncherData(store, targets);
          games.clear();
          sync.clearPlans();
          session.cloud = false;
        } finally {
          resetting = false;
        }
      });
    },
    get modifying() {
      return modifying;
    },
  };
}
export type LauncherRuntime = Awaited<ReturnType<typeof createRuntime>>;
