import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteLauncherData, prepareLauncherReset } from '../electron/services/reset';
import { SettingsStore } from '../electron/services/settings';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results/reset-'));
  roots.push(root);
  const userData = path.join(root, 'user');
  await fs.mkdir(userData);
  const store = new SettingsStore(userData, root);
  await store.load();
  await store.save({
    ...store.value,
    fullscreen: false,
    autoSyncSaves: false,
    cloudProvider: 'mega',
    remote: 'my-mega',
  });
  const disposable = [
    'credentials/rclone.conf',
    'covers/cover.img',
    'logs/transfers.jsonl',
    'profiles/defaults.ini',
    'auto-sync/history.json',
    'transfer-staging/stale/rclone.conf',
    'tools/rclone.exe',
  ];
  const kept = [
    path.join(store.value.downloadDirectory, 'Disc.iso'),
    path.join(store.value.emulatorRoot, 'versions/pcsx2.exe'),
    path.join(store.value.dataDirectory, 'PCSX2/inis/PCSX2.ini'),
    path.join(store.value.biosDirectory, 'bios.bin'),
    path.join(store.value.memcardsDirectory, 'card.ps2'),
    path.join(store.value.saveStatesDirectory, 'state.p2s'),
    path.join(userData, 'backups/old-card.ps2'),
    path.join(userData, 'user-created.txt'),
  ];
  for (const file of [...disposable.map((file) => path.join(userData, file)), ...kept]) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `fixture: ${file}`);
  }
  return { root, userData, store, disposable, kept };
}

describe('launcher data reset', () => {
  it('removes launcher accounts and metadata while retaining games, saves, BIOS, PCSX2, backups and their paths', async () => {
    const f = await fixture();
    const previous = structuredClone(f.store.value);
    const contents = await Promise.all(f.kept.map((file) => fs.readFile(file)));
    const targets = await prepareLauncherReset(f.userData, f.store.value);
    await deleteLauncherData(f.store, targets);
    for (const file of f.disposable) await expect(fs.access(path.join(f.userData, file))).rejects.toThrow();
    for (const [index, file] of f.kept.entries()) expect(await fs.readFile(file)).toEqual(contents[index]);
    for (const key of [
      'gameDirectories',
      'downloadDirectory',
      'emulatorRoot',
      'pcsx2Path',
      'dataDirectory',
      'biosDirectory',
      'memcardsDirectory',
      'saveStatesDirectory',
    ] as const)
      expect(f.store.value[key]).toEqual(previous[key]);
    expect(f.store.value).toMatchObject({
      cloudProvider: 'dropbox',
      remote: 'ps2-dropbox',
      cloudProfiles: {},
      fullscreen: true,
      autoSyncSaves: true,
    });
    const reloaded = new SettingsStore(f.userData, f.root);
    await reloaded.load();
    expect(reloaded.value).toEqual(f.store.value);
  });

  it('keeps custom external Rclone configuration files', async () => {
    const f = await fixture();
    const config = path.join(f.root, 'external.conf');
    await fs.writeFile(config, 'external account');
    await f.store.save({ ...f.store.value, rcloneConfig: config });
    await deleteLauncherData(f.store, await prepareLauncherReset(f.userData, f.store.value));
    expect(await fs.readFile(config, 'utf8')).toBe('external account');
    expect(f.store.value.rcloneConfig).toBe(path.join(f.userData, 'credentials/rclone.conf'));
  });

  it.each(['gameDirectories', 'emulatorRoot', 'memcardsDirectory', 'dataDirectory'] as const)(
    'refuses an overlap with %s before deleting anything',
    async (key) => {
      const f = await fixture();
      const folder = path.join(f.userData, 'tools', 'preserve');
      await f.store.save({ ...f.store.value, [key]: key === 'gameDirectories' ? [folder] : folder });
      await expect(prepareLauncherReset(f.userData, f.store.value)).rejects.toThrow('overlaps');
      expect(await fs.readFile(path.join(f.userData, 'credentials/rclone.conf'), 'utf8')).toContain(
        'fixture:',
      );
    },
  );

  it('rejects a substituted deletion target', async () => {
    const f = await fixture();
    const targets = await prepareLauncherReset(f.userData, f.store.value);
    targets[0] = f.store.value.downloadDirectory;
    await expect(deleteLauncherData(f.store, targets)).rejects.toThrow('paths changed');
    expect(await fs.readFile(f.kept[0], 'utf8')).toContain('fixture:');
  });

  it('revalidates protected paths if settings change after the preview', async () => {
    const f = await fixture();
    const targets = await prepareLauncherReset(f.userData, f.store.value);
    await f.store.save({ ...f.store.value, gameDirectories: [path.join(f.userData, 'covers')] });
    await expect(deleteLauncherData(f.store, targets)).rejects.toThrow('overlaps');
    await expect(fs.access(path.join(f.userData, 'credentials/rclone.conf'))).resolves.toBeUndefined();
  });

  it('refuses a junction to an external directory without following it', async () => {
    const f = await fixture();
    const outside = path.join(f.root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'marker'), 'keep');
    const tools = path.join(f.userData, 'tools');
    await fs.rm(tools, { recursive: true });
    await fs.symlink(outside, tools, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(prepareLauncherReset(f.userData, f.store.value)).rejects.toThrow('link outside');
    expect(await fs.readFile(path.join(outside, 'marker'), 'utf8')).toBe('keep');
  });
});
