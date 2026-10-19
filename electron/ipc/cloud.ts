import type { IpcContext } from './types';
export function registerCloudHandlers({ runtime, handle }: IpcContext) {
  const { pcsx2, cloud, autoSync, biosSync, transfers, exclusive } = runtime;
  handle('cloud:install', () => exclusive(() => cloud.install()));
  handle('cloud:connect', (input) =>
    exclusive(async () => {
      if (pcsx2.running) throw new Error('Close PCSX2 before changing cloud connections.');
      const status = await cloud.connect(input);
      if (status.connected) {
        await biosSync.enqueue('download');
        await biosSync.enqueue('upload');
      }
      return status;
    }),
  );
  handle('saves:sync', () =>
    exclusive(() => {
      if (transfers.activeSaves) throw new Error('A save transfer is already running.');
      return autoSync.synchronize();
    }),
  );
}
