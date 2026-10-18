import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { AutoSyncService, SyncCancelled } from '../electron/services/auto-sync';
import { SettingsStore } from '../electron/services/settings';
import type { RcloneService } from '../electron/services/rclone';
import { exists, walk } from '../electron/services/files';
import type { Direction } from '../shared/types';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir('test-results', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'auto-sync-'));
  roots.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  const cloud = path.join(root, 'cloud');
  const remotePath = (p: string) => (p.startsWith('fixture:') ? path.join(cloud, p.slice(8)) : p);
  const copy = vi.fn(async (args: string[]) => {
    const [command, from, to] = args;
    if (command === 'copy') {
      await fs.cp(remotePath(from), to, { recursive: true, preserveTimestamps: true });
    } else if (command === 'copyto') {
      const destination = remotePath(to);
      const backup = remotePath(args[args.indexOf('--backup-dir') + 1]);
      if (await exists(destination)) {
        await fs.mkdir(backup, { recursive: true });
        await fs.copyFile(destination, path.join(backup, path.basename(destination)));
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(remotePath(from), destination, { preserveTimestamps: true });
    } else throw new Error(`Unexpected command ${command}`);
    return '';
  });
  const rclone = {
    remote: (kind?: string) => `fixture:${store.value.cloudRoot}/${kind ?? ''}`.replace(/\/$/, ''),
    ensureFolders: async () => {
      for (const kind of ['Memcards', 'SaveStates'])
        await fs.mkdir(path.join(cloud, store.value.cloudRoot, kind), { recursive: true });
    },
    list: async (location: string) =>
      (await walk(remotePath(location))).map((f) => ({
        Path: f.path,
        Size: f.size,
        ModTime: f.modified,
        IsDir: false,
      })),
    call: copy,
  } as unknown as RcloneService;
  const resolve = vi.fn<() => Promise<Direction | undefined>>(async () => undefined);
  let running = false;
  const service = new AutoSyncService(
    store,
    rclone,
    () => {},
    resolve,
    () => running,
  );
  const local = path.join(store.value.memcardsDirectory, 'nested', 'card.ps2');
  const remote = path.join(cloud, 'PS2Cloud', 'Memcards', 'nested', 'card.ps2');
  const write = async (file: string, value: string) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value);
  };
  const backups = async () => {
    const result: string[] = [];
    for (const folder of [path.join(cloud, 'PS2Cloud', 'Backups'), path.join(store.userData, 'backups')])
      if (await exists(folder))
        for (const file of await walk(folder)) result.push(await fs.readFile(file.absolute, 'utf8'));
    return result;
  };
  return {
    store,
    service,
    rclone,
    local,
    remote,
    write,
    backups,
    resolve,
    copy,
    setRunning: () => {
      running = true;
    },
  };
}

it('merges new files both ways, skips equal content, and never touches games', async () => {
  const f = await fixture();
  await f.write(f.local, 'local card');
  await f.write(path.join(path.dirname(f.remote), 'other.ps2'), 'cloud card');
  await f.service.synchronize();
  expect(await fs.readFile(f.remote, 'utf8')).toBe('local card');
  expect(await fs.readFile(path.join(path.dirname(f.local), 'other.ps2'), 'utf8')).toBe('cloud card');
  f.copy.mockClear();
  await f.service.synchronize();
  expect(f.copy.mock.calls.some(([args]) => args[0] === 'copyto')).toBe(false);
  expect(f.copy.mock.calls.some(([args]) => args.some((a) => a.includes('Games')))).toBe(false);
  expect(f.resolve).not.toHaveBeenCalled();
});

it('detects same-size edits with unchanged timestamps using content hashes', async () => {
  const f = await fixture();
  await f.write(f.local, 'first');
  await f.service.synchronize();
  const stat = await fs.stat(f.local);
  await f.write(f.local, 'other');
  await fs.utimes(f.local, stat.atime, stat.mtime);
  await f.service.synchronize();
  expect(await fs.readFile(f.remote, 'utf8')).toBe('other');
  expect(await f.backups()).toContain('first');
  expect(f.resolve).not.toHaveBeenCalled();
});

it('downloads cloud-only edits and retains the previous local save', async () => {
  const f = await fixture();
  await f.write(f.local, 'base');
  await f.service.synchronize();
  await f.write(f.remote, 'new cloud');
  await f.service.synchronize();
  expect(await fs.readFile(f.local, 'utf8')).toBe('new cloud');
  expect(await f.backups()).toContain('base');
});

it.each(['upload', 'download'] as const)(
  'resolves two-device conflicts with %s and preserves losing version',
  async (direction) => {
    const f = await fixture();
    await f.write(f.local, 'base');
    await f.service.synchronize();
    await f.write(f.local, 'local edit');
    await f.write(f.remote, 'cloud edit');
    f.resolve.mockResolvedValue(direction);
    await f.service.synchronize();
    expect(f.resolve).toHaveBeenCalledWith([{ kind: 'Memcards', path: 'nested/card.ps2' }]);
    const expected = direction === 'upload' ? 'local edit' : 'cloud edit';
    expect(await fs.readFile(f.local, 'utf8')).toBe(expected);
    expect(await fs.readFile(f.remote, 'utf8')).toBe(expected);
    expect(await f.backups()).toContain(direction === 'upload' ? 'cloud edit' : 'local edit');
  },
);

it('cancels first-connect conflicts before any writes, including unrelated new files', async () => {
  const f = await fixture();
  await f.write(f.local, 'local');
  await f.write(f.remote, 'cloud');
  const extra = path.join(path.dirname(f.local), 'extra.ps2');
  await f.write(extra, 'extra');
  await expect(f.service.synchronize()).rejects.toBeInstanceOf(SyncCancelled);
  expect(f.copy.mock.calls.some(([args]) => args[0] === 'copyto')).toBe(false);
  expect(await fs.readFile(f.local, 'utf8')).toBe('local');
  expect(await fs.readFile(f.remote, 'utf8')).toBe('cloud');
  expect(f.service.busy).toBe(false);
});

it('rechecks content after conflict dialog before replacing files', async () => {
  const f = await fixture();
  await f.write(f.local, 'local');
  await f.write(f.remote, 'cloud');
  f.resolve.mockImplementation(async () => {
    await f.write(f.local, 'edited while choosing');
    return 'download';
  });
  await expect(f.service.synchronize()).rejects.toThrow('Saves changed');
  expect(await fs.readFile(f.local, 'utf8')).toBe('edited while choosing');
});

it('restores missing copies instead of propagating deletions', async () => {
  const f = await fixture();
  await f.write(f.local, 'save');
  await f.service.synchronize();
  await fs.unlink(f.local);
  await f.service.synchronize();
  expect(await fs.readFile(f.local, 'utf8')).toBe('save');
  await fs.unlink(f.remote);
  await f.service.synchronize();
  expect(await fs.readFile(f.remote, 'utf8')).toBe('save');
});

it('rejects concurrent gameplay and releases busy state after network failures', async () => {
  const f = await fixture();
  f.copy.mockRejectedValueOnce(new Error('offline'));
  await expect(f.service.synchronize()).rejects.toThrow('offline');
  expect(f.service.busy).toBe(false);
  f.setRunning();
  await expect(f.service.synchronize()).rejects.toThrow('Close PCSX2');
});

it('separates history when cloud folders change', async () => {
  const f = await fixture();
  await f.write(f.local, 'old');
  await f.service.synchronize();
  await f.store.save({ ...f.store.value, cloudRoot: 'DifferentCloud' });
  const otherRemote = f.remote.replace('PS2Cloud', 'DifferentCloud');
  await f.write(otherRemote, 'different cloud');
  await expect(f.service.synchronize()).rejects.toBeInstanceOf(SyncCancelled);
  expect(await fs.readFile(f.local, 'utf8')).toBe('old');
});

it('migrates old preferences with automatic saves enabled', async () => {
  const f = await fixture();
  const { autoSyncSaves: _, ...old } = f.store.value;
  await fs.mkdir(f.store.userData, { recursive: true });
  await fs.writeFile(path.join(f.store.userData, 'settings.json'), JSON.stringify(old));
  await f.store.load();
  expect(f.store.value.autoSyncSaves).toBe(true);
  await expect(
    f.store.save({ ...f.store.value, memcardsDirectory: path.join(f.store.userData, 'auto-sync') }),
  ).rejects.toThrow('credentials');
});

it('keeps provider histories separate even with matching remote and folder names', async () => {
  const f = await fixture();
  await f.write(f.local, 'base');
  await f.service.synchronize();
  await f.store.save({ ...f.store.value, cloudProvider: 'mega' });
  await f.write(f.remote, 'other provider');
  await expect(f.service.synchronize()).rejects.toBeInstanceOf(SyncCancelled);
  expect(await fs.readFile(f.local, 'utf8')).toBe('base');
});
