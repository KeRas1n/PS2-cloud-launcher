import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SettingsStore } from '../electron/services/settings';
import { createCloudStorage } from '../electron/services/cloud-storage-factory';
import { MegaCloudStorage } from '../electron/services/mega-cloud-storage';
import { RcloneRemoteControl } from '../electron/services/rclone-rc';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir('test-results', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'cloud-adapter-'));
  roots.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  return { root, store, cloud: createCloudStorage(store, () => {}) };
}

it('creates only the registered MEGA adapter and rejects unknown providers', async () => {
  const { store, cloud } = await fixture();
  expect(cloud).toBeInstanceOf(MegaCloudStorage);
  expect(cloud.provider).toBe('mega');
  Object.assign(store.value, { cloudProvider: 'unsupported' });
  expect(() => createCloudStorage(store, () => {})).toThrow('Unsupported cloud storage provider');
});

it('returns provider-neutral file metadata', async () => {
  const { cloud } = await fixture();
  vi.spyOn(RcloneRemoteControl.prototype, 'command').mockResolvedValue(
    JSON.stringify([{ Path: 'nested/disc.iso', Size: 123, ModTime: '2026-01-01', IsDir: false }]),
  );
  expect(await cloud.list(cloud.remote('Games'))).toEqual([
    { path: 'nested/disc.iso', size: 123, modified: '2026-01-01', isDirectory: false },
  ]);
});

it('freezes transfer account and credentials independently of later settings changes', async () => {
  const { root, store, cloud } = await fixture();
  await fs.mkdir(path.dirname(store.value.rcloneConfig), { recursive: true });
  await fs.writeFile(store.value.rcloneConfig, 'private fixture configuration');
  const scoped = await cloud.createTransferClient(structuredClone(store.value), path.join(root, 'worker'));
  await store.save({ ...store.value, remote: 'another-account', cloudRoot: 'OtherSaves' });
  await fs.writeFile(store.value.rcloneConfig, 'replaced account configuration');
  expect(scoped.client.remote('Games')).toBe('ps2-mega:PS2Cloud/Games');
  expect(cloud.remote('Games')).toBe('another-account:OtherSaves/Games');
  expect(await fs.readFile(scoped.store.value.rcloneConfig, 'utf8')).toBe('private fixture configuration');
  await scoped.client.close();
  await cloud.close();
});

it('cancels copying while allowing commit, rollback and staging cleanup to finish', async () => {
  const { cloud } = await fixture();
  const command = vi.spyOn(RcloneRemoteControl.prototype, 'command').mockResolvedValue('');
  const controller = new AbortController();
  cloud.setCancellation(controller.signal);
  controller.abort();
  await expect(cloud.copyFile('local.iso', 'remote:file.iso')).rejects.toThrow();
  expect(command).not.toHaveBeenCalled();
  await cloud.commitMove('remote:staged.iso', 'remote:final.iso');
  await cloud.commitDelete('remote:staged.iso');
  expect(command.mock.calls.map((call) => call[6])).toEqual([undefined, undefined]);
});

it('validates MEGA credentials at the adapter boundary before touching the transport', async () => {
  const { cloud } = await fixture();
  const command = vi.spyOn(RcloneRemoteControl.prototype, 'command').mockResolvedValue('');
  await expect(cloud.connect({ email: 'invalid', password: 'secret', code: 'bad' })).rejects.toThrow();
  expect(command).not.toHaveBeenCalled();
});
