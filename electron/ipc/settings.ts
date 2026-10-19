import { shell } from 'electron';
import { z } from 'zod';
import type { IpcContext } from './types';
export function registerSettingsHandlers({ runtime, handle, pick }: IpcContext) {
  const { store, pcsx2, cloud, games, exclusive } = runtime;
  handle('snapshot', async () => {
    const [emulator, cloudStatus] = await Promise.all([pcsx2.status(), cloud.status()]);
    return { settings: store.value, emulator: { ...emulator, running: pcsx2.running }, cloud: cloudStatus };
  });
  handle('settings:save', (input) =>
    exclusive(async () => {
      if (pcsx2.running) throw new Error('Close PCSX2 before changing paths.');
      const result = await store.save(input);
      games.games.clear();
      return result;
    }),
  );
  handle('settings:reset', (confirmed) => {
    if (z.literal(true).parse(confirmed) !== true) throw new Error('Reset requires confirmation.');
    return runtime.resetLauncher();
  });
  handle('dialog:pick', (kind) => pick(z.enum(['directory', 'executable', 'bios', 'cover']).parse(kind)));
  handle('link:open', (link) =>
    shell.openExternal(
      {
        pcsx2: 'https://pcsx2.net/docs/setup/',
        rclone: 'https://rclone.org/install/',
        mega: 'https://rclone.org/mega/',
      }[z.enum(['pcsx2', 'rclone', 'mega']).parse(link)],
    ),
  );
}
