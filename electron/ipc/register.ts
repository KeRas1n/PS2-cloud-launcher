import type { LauncherRuntime } from '../runtime';
import type { WindowReference } from '../window';
import { registerCloudHandlers } from './cloud';
import { createFilePicker } from './dialogs';
import { registerEmulatorHandlers } from './emulator';
import { registerGamesHandlers } from './games';
import { createIpcHandler } from './handle';
import { registerSettingsHandlers } from './settings';
import { registerTransfersHandlers } from './transfers';
export function registerIpc(
  runtime: LauncherRuntime,
  windows: WindowReference,
  devUrl: string | undefined,
  rendererFile: string,
) {
  const register = createIpcHandler(windows, devUrl, rendererFile);
  const context = {
    runtime,
    windows,
    handle: (channel: string, callback: (...args: any[]) => unknown) =>
      register(channel, (...args) => runtime.request(channel, () => callback(...args))),
    pick: createFilePicker(windows),
  };
  registerGamesHandlers(context);
  registerEmulatorHandlers(context);
  registerCloudHandlers(context);
  registerTransfersHandlers(context);
  registerSettingsHandlers(context);
}
