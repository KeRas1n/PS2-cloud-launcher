import { dialog } from 'electron';
import { z } from 'zod';
import { SyncCancelled } from '../services/auto-sync';
import type { IpcContext } from './types';
export function registerEmulatorHandlers({ runtime, windows, handle, pick }: IpcContext) {
  const { store, pcsx2, cloud, games, autoSync, transfers, exclusive, session } = runtime;
  const id = z.string().regex(/^[a-f0-9]{64}$/);
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
      session.cloud = false;
      if (game && store.value.autoSyncSaves) {
        // Prepare first: profile migration may select existing populated save folders.
        await pcsx2.prepare();
        const cloudStatus = await cloud.status();
        // A never-connected installation remains fully local without repeated prompts.
        if (cloudStatus.remotes.includes(store.value.remote)) {
          session.cloud = true;
          try {
            if (!cloudStatus.connected) throw new Error(cloudStatus.error ?? 'Cloud is unavailable.');
            await autoSync.synchronize();
          } catch (error) {
            if (error instanceof SyncCancelled) throw error;
            const result = await dialog.showMessageBox(windows.current!, {
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
      if ((await cloud.status()).connected) await runtime.biosSync.enqueue('upload');
      return 1;
    }),
  );
}
