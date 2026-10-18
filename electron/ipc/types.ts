import type { LauncherRuntime } from '../runtime';
import type { WindowReference } from '../window';
import type { createFilePicker } from './dialogs';
import type { createIpcHandler } from './handle';
export interface IpcContext {
  runtime: LauncherRuntime;
  windows: WindowReference;
  handle: ReturnType<typeof createIpcHandler>;
  pick: ReturnType<typeof createFilePicker>;
}
