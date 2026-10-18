import { shell } from 'electron';
import { z } from 'zod';
import type { IpcContext } from './types';
export function registerTransfersHandlers({ runtime, handle }: IpcContext) {
  const { rclone, sync, transfers, exclusive, enqueueTransfer } = runtime;
  const id = z.string().regex(/^[a-f0-9]{64}$/);
  handle('transfers:logs', async () => {
    const error = await shell.openPath(await rclone.transferLogDirectory());
    if (error) throw new Error('Could not open transfer logs.');
  });
  handle('sync:plan', (request) => {
    const input = z
      .object({
        kind: z.enum(['Games', 'Memcards', 'SaveStates']),
        direction: z.enum(['upload', 'download']),
        gameId: id.optional(),
      })
      .strict()
      .parse(request);
    return input.kind === 'Games' ? sync.plan(input) : exclusive(() => sync.plan(input));
  });
  handle('sync:enqueue', (planId, confirmed) => exclusive(() => enqueueTransfer(planId, confirmed)));
  handle('sync:execute', async (planId, confirmed) => {
    await exclusive(() => enqueueTransfer(planId, confirmed));
  });
  handle('transfers:list', () => transfers.list());
  handle('transfers:cancel', (id) => transfers.cancel(z.string().uuid().parse(id)));
  handle('sync:cancel', (planId) => sync.cancel(z.string().uuid().parse(planId)));
}
