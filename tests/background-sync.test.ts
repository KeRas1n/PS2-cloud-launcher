import { MegaCloudStorage } from '../electron/services/mega-cloud-storage';
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SettingsStore } from '../electron/services/settings';
import { SyncService } from '../electron/services/sync';
import { GameService } from '../electron/services/games';
import type { RcloneService } from '../electron/services/rclone';
import type { PCSX2Service } from '../electron/services/pcsx2';
import { walk } from '../electron/services/files';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'background-'));
  roots.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  await fs.mkdir(store.value.downloadDirectory, { recursive: true });
  const destination = path.join(store.value.downloadDirectory, 'Disc.iso');
  await fs.writeFile(destination, 'original');
  const controller = new AbortController();
  const remote = {
    ensureFolders: async () => {},
    remote: (kind = '') => `fixture:PS2Cloud/${kind}`,
    list: async () => [{ Path: 'Disc.iso', Size: 11, ModTime: '2026-01-01T00:00:00Z' }],
    call: async (args: string[]) => {
      await fs.writeFile(args[2], 'replacement');
      return '';
    },
  } as unknown as RcloneService;
  const games = new GameService(store, new MegaCloudStorage(remote));
  games.games.set('disc', {
    id: 'disc',
    name: 'Disc.iso',
    title: 'Disc',
    size: 11,
    state: 'In Cloud',
    localPath: destination,
    cloudPath: 'Disc.iso',
  });
  const emulator = { running: true, gamePath: path.join(root, 'Other.iso') } as PCSX2Service;
  const sync = new SyncService(
    store,
    new MegaCloudStorage(remote),
    games,
    emulator,
    () => {},
    true,
    controller.signal,
  );
  return { root, store, destination, controller, remote, emulator, sync };
}
describe('background download commit', () => {
  it('downloads during gameplay, keeps old image in backup and publishes only a complete disc', async () => {
    const f = await fixture();
    const plan = await f.sync.plan({ kind: 'Games', direction: 'download', gameId: 'disc' });
    await f.sync.execute(plan.id, true);
    expect(await fs.readFile(f.destination, 'utf8')).toBe('replacement');
    expect(await fs.readFile(path.join(plan.backupLocation, 'Disc.iso'), 'utf8')).toBe('original');
    expect((await walk(f.store.value.downloadDirectory)).map((file) => file.path)).toEqual(['Disc.iso']);
  });
  it('removes cancelled partial downloads, never replaces the original', async () => {
    const f = await fixture();
    f.remote.call = async (args) => {
      await fs.writeFile(args[2], 'partial');
      f.controller.abort();
      f.controller.signal.throwIfAborted();
      return '';
    };
    const plan = await f.sync.plan({ kind: 'Games', direction: 'download', gameId: 'disc' });
    await expect(f.sync.execute(plan.id, true)).rejects.toThrow();
    expect(await fs.readFile(f.destination, 'utf8')).toBe('original');
    expect((await walk(f.store.value.downloadDirectory)).map((file) => file.path)).toEqual(['Disc.iso']);
  });
  it('does not replace the image currently used by PCSX2', async () => {
    const f = await fixture();
    f.emulator.gamePath = f.destination;
    const plan = await f.sync.plan({ kind: 'Games', direction: 'download', gameId: 'disc' });
    await expect(f.sync.execute(plan.id, true)).rejects.toThrow('Close this game');
    expect(await fs.readFile(f.destination, 'utf8')).toBe('original');
  });
  it('does not overwrite an edit made while downloading', async () => {
    const f = await fixture();
    f.remote.call = async (args) => {
      await fs.writeFile(args[2], 'replacement');
      await fs.writeFile(f.destination, 'external modification');
      return '';
    };
    const plan = await f.sync.plan({ kind: 'Games', direction: 'download', gameId: 'disc' });
    await expect(f.sync.execute(plan.id, true)).rejects.toThrow('Destination changed');
    expect(await fs.readFile(f.destination, 'utf8')).toBe('external modification');
  });
});
