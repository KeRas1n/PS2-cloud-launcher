import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BiosSyncService } from '../electron/services/bios-sync';
import type { CloudStorage } from '../electron/services/cloud-storage';
import { SettingsStore } from '../electron/services/settings';
import { PCSX2ProfileService } from '../electron/services/profile';
import { TransferQueue } from '../electron/services/transfer-queue';
import { walk } from '../electron/services/files';

const roots: string[] = [];
const queues: TransferQueue[] = [];
// Synthetic ROM metadata, no executable BIOS contents.
function biosFixture() {
  const data = Buffer.alloc(512 * 1024);
  for (const [index, name, length] of [
    [0, 'RESET', 0x100],
    [1, 'ROMDIR', 64],
    [2, 'ROMVER', 14],
  ] as const) {
    data.write(name, 0x100 + index * 16, 'ascii');
    data.writeUInt32LE(length, 0x100 + index * 16 + 12);
  }
  data.write('0200EC20040614', 0x140, 'ascii');
  return data;
}
async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'bios-sync-'));
  roots.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  const remote = path.join(root, 'cloud', 'BIOS');
  const close = vi.fn(async () => {});
  const copyFile = vi.fn(async (source: string, destination: string) => {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  });
  const client = {
    remote: () => remote,
    ensureFolders: async () => {
      await fs.mkdir(remote, { recursive: true });
    },
    list: async () => (await walk(remote)).map((file) => ({ ...file, isDirectory: false })),
    copyFile,
    setCancellation: vi.fn(),
    close,
  } as unknown as CloudStorage;
  const cloud = {
    createTransferClient: vi.fn(async (_settings, directory: string) => {
      await fs.mkdir(directory, { recursive: true });
      return { client, store };
    }),
  } as unknown as CloudStorage;
  const queue = new TransferQueue(() => {});
  queues.push(queue);
  const downloaded = vi.fn(async () => {});
  const service = new BiosSyncService(store, cloud, queue, downloaded);
  return { root, remote, store, client, cloud, queue, close, copyFile, downloaded, service };
}
async function finish(queue: TransferQueue) {
  await vi.waitFor(() => expect(queue.active).toBe(false));
}
afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.shutdown();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('copies imported BIOS into emulator/data/bios and uploads through the manager', async () => {
  const f = await fixture();
  expect(f.store.value.biosDirectory).toBe(path.join(f.root, 'emulator', 'data', 'bios'));
  const source = path.join(f.root, 'console.bin');
  await fs.writeFile(source, biosFixture());
  await new PCSX2ProfileService(f.store).importBios(source);
  await f.service.enqueue('upload');
  await finish(f.queue);
  expect(await fs.readFile(path.join(f.remote, 'console.bin'))).toEqual(biosFixture());
  expect(await fs.readFile(source)).toEqual(biosFixture());
  expect(f.queue.list()[0]).toMatchObject({
    kind: 'BIOS',
    direction: 'upload',
    state: 'completed',
    bytes: biosFixture().length,
  });
  expect(f.close).toHaveBeenCalledOnce();
  expect(await fs.readdir(path.join(f.store.userData, 'transfer-staging'))).toEqual([]);
});

it('restores BIOS from MEGA through the manager and prepares the emulator', async () => {
  const f = await fixture();
  await fs.mkdir(f.remote, { recursive: true });
  await fs.writeFile(path.join(f.remote, 'console.bin'), biosFixture());
  await f.service.enqueue('download');
  await finish(f.queue);
  expect(await fs.readFile(path.join(f.store.value.biosDirectory, 'console.bin'))).toEqual(biosFixture());
  expect(f.downloaded).toHaveBeenCalledOnce();
  expect(f.queue.list()[0]).toMatchObject({
    direction: 'download',
    state: 'completed',
    totalBytes: biosFixture().length,
  });
});

it('keeps existing local and remote files and ignores unrelated local files', async () => {
  const f = await fixture();
  await fs.mkdir(f.remote, { recursive: true });
  await fs.mkdir(f.store.value.biosDirectory, { recursive: true });
  await fs.writeFile(path.join(f.remote, 'console.bin'), biosFixture());
  await fs.writeFile(path.join(f.store.value.biosDirectory, 'console.bin'), 'keep local');
  await fs.writeFile(path.join(f.store.value.biosDirectory, 'notes.txt'), 'not BIOS');
  await f.service.enqueue('download');
  await f.service.enqueue('upload');
  await finish(f.queue);
  expect(await fs.readFile(path.join(f.store.value.biosDirectory, 'console.bin'), 'utf8')).toBe('keep local');
  expect(await fs.readFile(path.join(f.remote, 'console.bin'))).toEqual(biosFixture());
  expect(f.copyFile).not.toHaveBeenCalled();
});

it('rejects invalid cloud BIOS without installing partial files', async () => {
  const f = await fixture();
  await fs.mkdir(f.remote, { recursive: true });
  await fs.writeFile(path.join(f.remote, 'invalid.bin'), Buffer.alloc(512 * 1024));
  await f.service.enqueue('download');
  await finish(f.queue);
  expect(f.queue.list()[0]).toMatchObject({ state: 'failed', error: 'Invalid BIOS in MEGA: invalid.bin' });
  expect(await fs.readdir(f.store.value.biosDirectory)).toEqual([]);
  expect(f.downloaded).not.toHaveBeenCalled();
});

it('reports network errors in the manager and cleans up the transfer client', async () => {
  const f = await fixture();
  f.client.list = async () => {
    throw new Error('MEGA unavailable');
  };
  await f.service.enqueue('download');
  await finish(f.queue);
  expect(f.queue.list()[0]).toMatchObject({ state: 'failed', error: 'MEGA unavailable' });
  expect(f.close).toHaveBeenCalledOnce();
});

it('cancels a download before installing BIOS', async () => {
  const f = await fixture();
  await fs.mkdir(f.remote, { recursive: true });
  await fs.writeFile(path.join(f.remote, 'console.bin'), biosFixture());
  let started = false;
  f.client.copyFile = async (_source, destination) => {
    started = true;
    await vi.waitFor(() => expect(f.queue.list()[0].state).toBe('cancelling'));
    await fs.writeFile(destination, biosFixture());
  };
  const transfer = await f.service.enqueue('download');
  await vi.waitFor(() => expect(started).toBe(true));
  f.queue.cancel(transfer!.id);
  await finish(f.queue);
  expect(f.queue.list()[0].state).toBe('cancelled');
  expect(await fs.readdir(f.store.value.biosDirectory)).toEqual([]);
});
