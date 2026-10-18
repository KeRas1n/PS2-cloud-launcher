import { ipcMain } from 'electron';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { WindowReference } from '../window';
// Every route uses the same sender validation and error normalization.
export function createIpcHandler(windows: WindowReference, devUrl: string | undefined, rendererFile: string) {
  return function handle(channel: string, callback: (...args: any[]) => unknown) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const url = event.senderFrame?.url;
      const expected = devUrl ? new URL(devUrl).origin : pathToFileURL(rendererFile).href;
      if (
        !windows.current ||
        event.sender !== windows.current.webContents ||
        event.senderFrame !== windows.current.webContents.mainFrame ||
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
  };
}
