import { shell } from 'electron';
import { z } from 'zod';
import type { IpcContext } from './types';
export function registerSettingsHandlers({ runtime, handle, pick }: IpcContext) {
  const { store, pcsx2, rclone, games, exclusive } = runtime;
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
}
