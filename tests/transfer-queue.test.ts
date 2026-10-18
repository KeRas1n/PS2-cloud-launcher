import { describe, expect, it, vi } from 'vitest';
import { TransferQueue } from '../electron/services/transfer-queue';
import type { Transfer } from '../shared/types';

const input = (title: string, kind: Transfer['kind'] = 'Games') => ({
  title,
  kind,
  direction: 'download' as const,
  provider: 'mega' as const,
  totalBytes: 100,
});
const pending = () => {
  let finish!: () => void;
  const run = vi.fn(
    (signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  return { run, finish: () => finish() };
};

describe('background transfer queue', () => {
  it('runs two games, queues the third, cancels one without stopping the other', async () => {
    const queue = new TransferQueue(() => {});
    const a = pending(),
      b = pending(),
      c = pending();
    const first = queue.add(input('A'), ['a'], a.run);
    const second = queue.add(input('B'), ['b'], b.run);
    const third = queue.add(input('C'), ['c'], c.run);
    await vi.waitFor(() => expect(a.run).toHaveBeenCalledOnce());
    expect(b.run).toHaveBeenCalledOnce();
    expect(c.run).not.toHaveBeenCalled();
    expect(queue.list().map((t) => t.state)).toEqual(['running', 'running', 'queued']);
    expect(() => queue.add(input('duplicate'), ['b'], pending().run)).toThrow('already');
    queue.cancel(first.id);
    await vi.waitFor(() => expect(c.run).toHaveBeenCalledOnce());
    expect(queue.list().find((t) => t.id === first.id)?.state).toBe('cancelled');
    expect(queue.list().find((t) => t.id === second.id)?.state).toBe('running');
    b.finish();
    c.finish();
    await vi.waitFor(() => expect(queue.active).toBe(false));
    expect(queue.list().find((t) => t.id === third.id)?.state).toBe('completed');
    await queue.shutdown();
  });
  it('never starts cancelled queued work and waits for cleanup on shutdown', async () => {
    const queue = new TransferQueue(() => {});
    const cleanup = vi.fn(async () => {}),
      a = pending(),
      b = pending(),
      c = pending();
    queue.add(input('A'), ['a'], a.run, cleanup);
    queue.add(input('B'), ['b'], b.run, cleanup);
    const third = queue.add(input('C'), ['c'], c.run, cleanup);
    queue.cancel(third.id);
    await queue.shutdown();
    expect(c.run).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(queue.list().every((t) => t.state === 'cancelled')).toBe(true);
  });
  it('releases slots after failure and reports each job own progress', async () => {
    const queue = new TransferQueue(() => {});
    const third = pending();
    queue.add(input('A'), ['a'], async (_, progress) => {
      progress({ operation: 'sync', message: 'A bytes', bytes: 42, speed: 12 });
      throw new Error('network failed');
    });
    queue.add(input('B'), ['b'], pending().run);
    queue.add(input('C'), ['c'], third.run);
    await vi.waitFor(() => expect(third.run).toHaveBeenCalledOnce());
    expect(queue.list()[0]).toMatchObject({ state: 'failed', bytes: 42, speed: 0, error: 'network failed' });
    expect(queue.list()[1].bytes).toBe(0);
    await queue.shutdown();
  });
  it('lets games pass saves waiting for emulator exit and serializes save writers', async () => {
    let playing = true;
    const queue = new TransferQueue(
      () => {},
      2,
      (t) => t.kind === 'Games' || !playing,
    );
    const save = pending(),
      save2 = pending(),
      game = pending();
    queue.add(input('cards', 'Memcards'), ['cards'], save.run);
    queue.add(input('states', 'SaveStates'), ['states'], save2.run);
    queue.add(input('game'), ['game'], game.run);
    await vi.waitFor(() => expect(game.run).toHaveBeenCalledOnce());
    expect(save.run).not.toHaveBeenCalled();
    playing = false;
    queue.wake();
    await vi.waitFor(() => expect(save.run).toHaveBeenCalledOnce());
    expect(queue.activeSaves).toBe(true);
    expect(save2.run).not.toHaveBeenCalled();
    save.finish();
    await vi.waitFor(() => expect(save2.run).toHaveBeenCalledOnce());
    await queue.shutdown();
  });
});
