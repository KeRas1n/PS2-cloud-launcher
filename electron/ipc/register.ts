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
  const context = {
    runtime,
    windows,
    handle: createIpcHandler(windows, devUrl, rendererFile),
    pick: createFilePicker(windows),
  };
  registerGamesHandlers(context);
  registerEmulatorHandlers(context);
  registerCloudHandlers(context);
  registerTransfersHandlers(context);
  registerSettingsHandlers(context);
}
