import { z } from 'zod';
import type { IpcContext } from './types';
export function registerCloudHandlers({ runtime, handle }: IpcContext) {
  const { store, pcsx2, rclone, games, autoSync, transfers, exclusive } = runtime;
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
  handle('saves:sync', () =>
    exclusive(() => {
      if (transfers.activeSaves) throw new Error('A save transfer is already running.');
      return autoSync.synchronize();
    }),
  );
}
