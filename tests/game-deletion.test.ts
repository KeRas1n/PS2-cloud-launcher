import { MegaCloudStorage } from '../electron/services/mega-cloud-storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SettingsStore } from '../electron/services/settings';
import { GameService } from '../electron/services/games';
import type { RcloneService } from '../electron/services/rclone';

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'delete-game-'));
  roots.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  const directory = path.join(root, 'games');
  await fs.mkdir(directory);
  await store.save({ ...store.value, gameDirectories: [directory] });
  const local = path.join(directory, 'Disc.bin');
  await fs.writeFile(local, 'own test fixture');
  let cloud = true;
  const mutate = vi.fn();
  const remote = {
    status: async () => ({ connected: true, installed: true, remotes: [store.value.remote] }),
    remote: () => 'fixture:Games',
    list: async () => (cloud ? [{ Path: 'Disc.bin', Size: 16, ModTime: '2026-01-01' }] : []),
    call: mutate,
  } as unknown as RcloneService;
  const games = new GameService(store, new MegaCloudStorage(remote));
  games.games.set('disc', {
    id: 'disc',
    name: 'Disc.bin',
    title: 'Disc',
    state: 'In Cloud',
    size: 16,
    localPath: local,
    cloudPath: 'Disc.bin',
  });
  return {
    root,
    store,
    directory,
    local,
    remote,
    games,
    mutate,
    setCloud: (value: boolean) => {
      cloud = value;
    },
  };
}
describe('confirmed local game deletion', () => {
  it('preview and cancellation never delete; explicit confirmation removes only the local image', async () => {
    const f = await fixture();
    const preview = await f.games.prepareDelete('disc');
    expect(preview.cloud).toBe('stored');
    expect(await fs.readFile(f.local, 'utf8')).toBe('own test fixture');
    await expect(f.games.deleteLocal(preview.token, false)).rejects.toThrow('Confirm');
    expect(await fs.readFile(f.local, 'utf8')).toBe('own test fixture');
    const sibling = path.join(f.directory, 'Other.iso');
    await fs.writeFile(sibling, 'keep');
    await f.games.deleteLocal(preview.token, true);
    await expect(fs.access(f.local)).rejects.toThrow();
    expect(await fs.readFile(sibling, 'utf8')).toBe('keep');
    expect(f.games.get('disc')).toMatchObject({ state: 'Cloud Only', localPath: undefined });
    expect(f.mutate).not.toHaveBeenCalled();
    await expect(f.games.deleteLocal(preview.token, true)).rejects.toThrow('expired');
  });
  it('detects missing cloud copies even when the old library said In Cloud', async () => {
    const f = await fixture();
    f.setCloud(false);
    const preview = await f.games.prepareDelete('disc');
    expect(preview.cloud).toBe('missing');
    await f.games.deleteLocal(preview.token, true);
    expect(f.games.games.size).toBe(0);
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it('reports offline cloud as unknown and does not claim a backup exists', async () => {
    const f = await fixture();
    f.remote.status = async () => {
      throw new Error('offline');
    };
    expect((await f.games.prepareDelete('disc')).cloud).toBe('unknown');
    expect(await fs.readFile(f.local, 'utf8')).toBe('own test fixture');
  });
  it('refuses deletion if the cloud copy disappears after confirmation is prepared', async () => {
    const f = await fixture();
    const preview = await f.games.prepareDelete('disc');
    f.setCloud(false);
    await expect(f.games.deleteLocal(preview.token, true)).rejects.toThrow('Cloud status changed');
    expect(await fs.readFile(f.local, 'utf8')).toBe('own test fixture');
  });
  it('refuses a file changed after preview', async () => {
    const f = await fixture();
    const preview = await f.games.prepareDelete('disc');
    await fs.writeFile(f.local, 'replacement');
    await expect(f.games.deleteLocal(preview.token, true)).rejects.toThrow('Game file changed');
    expect(await fs.readFile(f.local, 'utf8')).toBe('replacement');
  });
  it('rejects a different provider/settings and expired or invented tokens', async () => {
    const f = await fixture();
    const preview = await f.games.prepareDelete('disc');
    f.store.value.remote = 'different';
    await expect(f.games.deleteLocal(preview.token, true)).rejects.toThrow('Settings or game changed');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await expect(f.games.deleteLocal(preview.token, true)).rejects.toThrow('expired');
    await expect(f.games.deleteLocal('invented', true)).rejects.toThrow('expired');
    vi.useRealTimers();
    expect(await fs.readFile(f.local, 'utf8')).toBe('own test fixture');
  });
  it('does not delete cloud-only entries or directories', async () => {
    const f = await fixture();
    const game = f.games.get('disc');
    game.localPath = undefined;
    await expect(f.games.prepareDelete('disc')).rejects.toThrow('no local file');
    const directory = path.join(f.directory, 'Folder.iso');
    await fs.mkdir(directory);
    game.localPath = directory;
    await expect(f.games.prepareDelete('disc')).rejects.toThrow('regular local game file');
  });
  it('rejects files outside the library and junctions escaping the library', async () => {
    const f = await fixture();
    const outside = path.join(f.root, 'outside');
    await fs.mkdir(outside);
    const target = path.join(outside, 'External.iso');
    await fs.writeFile(target, 'keep');
    f.games.get('disc').localPath = target;
    await expect(f.games.prepareDelete('disc')).rejects.toThrow('outside');
    const link = path.join(f.directory, 'escape');
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    f.games.get('disc').localPath = path.join(link, 'External.iso');
    await expect(f.games.prepareDelete('disc')).rejects.toThrow('outside');
    expect(await fs.readFile(target, 'utf8')).toBe('keep');
  });
});
