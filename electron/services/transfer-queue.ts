import { randomUUID } from 'node:crypto';
import type { Progress, Transfer } from '../../shared/types';

interface Work {
  transfer: Transfer;
  controller: AbortController;
  keys: string[];
  run: (signal: AbortSignal, progress: (p: Progress) => void) => Promise<void>;
  cleanup?: () => Promise<void>;
  cleaning?: Promise<void>;
}
export const isActiveTransfer = (t: Transfer) => ['queued', 'running', 'cancelling'].includes(t.state);
export class TransferQueue {
  private work = new Map<string, Work>();
  private running = 0;
  private closed = false;
  private waiters: (() => void)[] = [];
  constructor(
    private changed: (transfers: Transfer[]) => void,
    private limit = 2,
    private canStart: (transfer: Transfer) => boolean = () => true,
  ) {}
  wake() {
    this.pump();
  }
  list() {
    return [...this.work.values()].map((w) => ({ ...w.transfer }));
  }
  get active() {
    return this.list().some(isActiveTransfer);
  }
  get activeSaves() {
    return this.list().some((t) => t.kind !== 'Games' && ['running', 'cancelling'].includes(t.state));
  }
  has(key: string) {
    return [...this.work.values()].some((w) => isActiveTransfer(w.transfer) && w.keys.includes(key));
  }
  add(
    input: Omit<Transfer, 'id' | 'state' | 'bytes' | 'speed' | 'message'>,
    keys: string[],
    run: Work['run'],
    cleanup?: Work['cleanup'],
  ) {
    if (this.closed) throw new Error('Launcher is shutting down.');
    if (keys.some((key) => this.has(key)))
      throw new Error('This file already has a queued or running transfer.');
    const transfer: Transfer = {
      ...input,
      id: randomUUID(),
      state: 'queued',
      bytes: 0,
      speed: 0,
      message: 'Waiting in queue',
    };
    this.work.set(transfer.id, { transfer, keys, controller: new AbortController(), run, cleanup });
    this.publish();
    this.pump();
    return { ...transfer };
  }
  cancel(id: string) {
    const work = this.work.get(id);
    if (!work || !isActiveTransfer(work.transfer)) return;
    if (work.transfer.state === 'queued') {
      work.controller.abort();
      work.transfer.state = 'cancelled';
      work.transfer.message = 'Cancelled';
      void this.cleanup(work).then(() => this.pump());
    } else {
      work.transfer.state = 'cancelling';
      work.transfer.message = 'Cancelling…';
      work.controller.abort();
    }
    work.transfer.speed = 0;
    this.publish();
  }
  async shutdown() {
    this.closed = true;
    for (const id of this.work.keys()) this.cancel(id);
    if (this.running) await new Promise<void>((resolve) => this.waiters.push(resolve));
    await Promise.all([...this.work.values()].map((w) => this.cleanup(w)));
  }
  private async cleanup(work: Work) {
    if (work.cleaning) return work.cleaning;
    const cleanup = work.cleanup;
    work.cleanup = undefined;
    work.cleaning = Promise.resolve()
      .then(() => cleanup?.())
      .catch(() => {});
    await work.cleaning;
  }
  private publish() {
    this.changed(this.list());
  }
  private pump() {
    if (this.closed) return;
    for (const work of this.work.values()) {
      if (this.running >= this.limit) break;
      if (work.transfer.state !== 'queued') continue;
      if (!this.canStart(work.transfer)) continue;
      // Only one manual save operation at a time; game transfers can run alongside it.
      if (work.transfer.kind !== 'Games' && this.activeSaves) continue;
      this.running++;
      work.transfer.state = 'running';
      work.transfer.message = 'Starting transfer…';
      this.publish();
      void Promise.resolve()
        .then(() =>
          work.run(work.controller.signal, (progress) => {
            if (work.transfer.state !== 'running') return;
            work.transfer.bytes = progress.bytes ?? work.transfer.bytes;
            work.transfer.totalBytes = progress.totalBytes ?? work.transfer.totalBytes;
            work.transfer.speed = progress.speed ?? 0;
            work.transfer.message = progress.message;
            this.publish();
          }),
        )
        .then(
          () => {
            work.transfer.state = 'completed';
            work.transfer.bytes = work.transfer.totalBytes;
            work.transfer.message = 'Complete';
          },
          (error) => {
            const cancelled = work.controller.signal.aborted;
            work.transfer.state = cancelled ? 'cancelled' : 'failed';
            work.transfer.message = cancelled ? 'Cancelled' : 'Transfer failed';
            if (!cancelled || error?.name !== 'AbortError')
              work.transfer.error = error?.message ?? 'Transfer failed';
          },
        )
        .finally(async () => {
          work.transfer.speed = 0;
          await this.cleanup(work);
          this.running--;
          this.publish();
          const finished = [...this.work.values()].filter((w) => !isActiveTransfer(w.transfer));
          for (const old of finished.slice(0, Math.max(0, finished.length - 50)))
            this.work.delete(old.transfer.id);
          if (!this.running) {
            for (const resolve of this.waiters.splice(0)) resolve();
          }
          this.pump();
        });
    }
  }
}
