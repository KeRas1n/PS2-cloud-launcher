import { expect, it, vi } from 'vitest';
import { registerCloudHandlers } from '../electron/ipc/cloud';
import type { IpcContext } from '../electron/ipc/types';

function fixture() {
  const events: string[] = [];
  const handlers = new Map<string, (input?: unknown) => Promise<unknown>>();
  const connect = vi.fn(async () => {
    events.push('connected');
    return { connected: true };
  });
  const enqueue = vi.fn(async (direction: string) => {
    events.push(direction);
  });
  registerCloudHandlers({
    runtime: {
      pcsx2: { running: false },
      cloud: { connect },
      biosSync: { enqueue },
      exclusive: async (action: () => Promise<unknown>) => action(),
    },
    handle: (name: string, action: (input?: unknown) => Promise<unknown>) => handlers.set(name, action),
  } as unknown as IpcContext);
  return { events, connect, enqueue, run: handlers.get('cloud:connect')! };
}

it('queues BIOS restoration and backup after successful MEGA sign-in', async () => {
  const f = fixture();
  const credentials = { email: 'test@example.com', password: 'fixture' };
  await expect(f.run(credentials)).resolves.toEqual({ connected: true });
  expect(f.connect).toHaveBeenCalledWith(credentials);
  expect(f.events).toEqual(['connected', 'download', 'upload']);
});

it('restores BIOS when retrying a saved MEGA connection', async () => {
  const f = fixture();
  await f.run();
  expect(f.events).toEqual(['connected', 'download', 'upload']);
});

it('does not transfer BIOS after failed authorization', async () => {
  const f = fixture();
  f.connect.mockRejectedValue(new Error('Sign-in failed'));
  await expect(f.run()).rejects.toThrow('Sign-in failed');
  expect(f.enqueue).not.toHaveBeenCalled();
});
