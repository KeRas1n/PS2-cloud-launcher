import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SettingsStore } from '../electron/services/settings';
import { safeRelative, within, walk } from '../electron/services/files';
import { PCSX2Service, selectAsset, updateFolders } from '../electron/services/pcsx2';
import { fingerprint, makeFiles, SyncService } from '../electron/services/sync';
import { GameService } from '../electron/services/games';
import type { RcloneService } from '../electron/services/rclone';

const temporary: string[] = [];
async function temp() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'services-'));
  temporary.push(root);
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const entry = (name: string, modified = '2026-01-01', size = 1) => ({ path: name, modified, size });

describe('path and configuration safety', () => {
  it.each(['../bios.bin', '/etc/passwd', 'C:/Windows/file', 'a\\b', 'a/../b', 'a//b', './a', 'a\0b'])(
    'rejects unsafe cloud paths: %s',
    (value) => expect(() => safeRelative(value)).toThrow(),
  );
  it('resolves nested paths inside the destination', () =>
    expect(within(path.resolve('games'), 'folder/disc.iso')).toBe(path.resolve('games/folder/disc.iso')));
  it('persists settings and rejects option injection', async () => {
    const root = await temp(),
      store = new SettingsStore(path.join(root, 'user'), root);
    await store.load();
    await store.save({ ...store.value, remote: 'my-dropbox', fullscreen: false });
    const loaded = new SettingsStore(path.join(root, 'user'), root);
    await loaded.load();
    expect(loaded.value.remote).toBe('my-dropbox');
    expect(loaded.value.fullscreen).toBe(false);
    await expect(store.save({ ...store.value, remote: '--config' })).rejects.toThrow();
    await expect(store.save({ ...store.value, cloudRoot: '../private' })).rejects.toThrow();
    await expect(store.save({ ...store.value, rclonePath: '--help' })).rejects.toThrow();
  });
  it('rejects corrupt settings without silently replacing user paths', async () => {
    const root = await temp();
    await fs.writeFile(path.join(root, 'settings.json'), '{broken');
    await expect(new SettingsStore(root, root).load()).rejects.toThrow('Settings file is invalid');
  });
  it('prevents save uploads from containing credentials or retained backups', async () => {
    const root = await temp(),
      store = new SettingsStore(path.join(root, 'user'), root);
    await store.load();
    await expect(store.save({ ...store.value, memcardsDirectory: store.userData })).rejects.toThrow(
      'credentials',
    );
    await expect(
      store.save({ ...store.value, memcardsDirectory: path.join(store.userData, 'backups', 'cards') }),
    ).rejects.toThrow('credentials');
    await expect(
      store.save({ ...store.value, rcloneConfig: path.join(store.value.memcardsDirectory, 'token.conf') }),
    ).rejects.toThrow('credentials');
    await expect(
      store.save({ ...store.value, saveStatesDirectory: path.join(store.value.memcardsDirectory, 'states') }),
    ).rejects.toThrow('non-overlapping');
  });
});
describe('PCSX2 release and data handling', () => {
  const release = {
    tag_name: 'v2.8.2',
    prerelease: false,
    assets: [
      'pcsx2-v2.8.2-windows-x64-installer.exe',
      'pcsx2-v2.8.2-windows-x64-Qt-symbols.7z',
      'pcsx2-v2.8.2-windows-x64-Qt.7z',
      'pcsx2-v2.8.2-linux-appimage-x64-Qt.AppImage',
    ].map((name) => ({
      name,
      browser_download_url: `https://github.com/PCSX2/pcsx2/releases/download/v2.8.2/${name}`,
    })),
  };
  it('selects official portable assets for Windows and Linux', () => {
    expect(selectAsset(release, 'win32', 'x64').name).toMatch(/x64-Qt\.7z$/);
    expect(selectAsset(release, 'linux', 'x64').name).toMatch(/\.AppImage$/);
    expect(() => selectAsset(release, 'linux', 'arm64')).toThrow('x86-64');
  });
  it('changes only launcher-owned folder keys and preserves all other settings', () => {
    const ini =
      '[UI]\nTheme = dark\n[Folders]\nMemoryCards = old\nSavestates=old\nTextures = textures\n[EmuCore]\nEnableCheats = true';
    const next = updateFolders(ini, { MemoryCards: 'D:/PS2/memcards', Savestates: 'D:/PS2/states' });
    expect(next).toContain('Theme = dark');
    expect(next).toContain('Textures = textures');
    expect(next).toContain('EnableCheats = true');
    expect(next).not.toContain('= old');
    expect(next).toContain('MemoryCards = D:/PS2/memcards');
    expect(updateFolders(next, { MemoryCards: 'D:/new' }).match(/MemoryCards =/g)).toHaveLength(1);
  });
  it('reports process start and exit so emulator controls do not remain disabled', async () => {
    const root = await temp(),
      store = new SettingsStore(path.join(root, 'user'), root);
    await store.load();
    await store.save({ ...store.value, pcsx2Path: process.execPath });
    const states: boolean[] = [];
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const service = new PCSX2Service(store, (progress) => {
      if (progress.emulatorRunning !== undefined) states.push(progress.emulatorRunning);
      if (progress.emulatorRunning === false) resolveExit();
    });
    vi.spyOn(service.profiles, 'prepare').mockResolvedValue({
      directory: root,
      prepared: true,
      ready: true,
      bios: [],
    });
    const game = path.join(root, 'process-fixture.iso');
    await fs.writeFile(game, 'process lifecycle fixture, not a game');
    // Node is a short-lived process fixture: it exits when given PCSX2 arguments.
    await service.launch(game);
    await exited;
    expect(states).toEqual([true, false]);
    expect(service.running).toBe(false);
  });
});
describe('game discovery', () => {
  it('scans recursively, filters disc images and merges cloud/local states', async () => {
    const root = await temp(),
      store = new SettingsStore(path.join(root, 'user'), root);
    await store.load();
    const games = path.join(root, 'games');
    await fs.mkdir(path.join(games, 'nested'), { recursive: true });
    await fs.writeFile(path.join(games, 'Local.iso'), 'local');
    await fs.writeFile(path.join(games, 'nested', 'Shared.chd'), 'shared');
    await fs.writeFile(path.join(games, 'not-a-game.txt'), 'text');
    await store.save({ ...store.value, gameDirectories: [games] });
    const remote = {
      status: async () => ({ connected: true }),
      ensureFolders: async () => {},
      remote: () => 'remote:Games',
      list: async () => [
        { Path: 'Shared.chd', Size: 6, ModTime: '2026-01-01' },
        { Path: 'Cloud.iso', Size: 5, ModTime: '2026-01-01' },
      ],
    } as unknown as RcloneService;
    const library = await new GameService(store, remote).scan();
    expect(library.cloudChecked).toBe(true);
    expect(library.games).toHaveLength(3);
    expect(library.games.find((g) => g.name === 'Local.iso')?.state).toBe('Local Only');
    expect(library.games.find((g) => g.name === 'Shared.chd')?.state).toBe('In Cloud');
    expect(library.games.find((g) => g.name === 'Cloud.iso')?.state).toBe('Cloud Only');
  });
});
describe('conflict review', () => {
  it('flags every existing destination conservatively and includes previous size', () => {
    expect(makeFiles([entry('old.ps2'), entry('new.ps2')], [entry('old.ps2', '', 30)])).toEqual([
      { path: 'old.ps2', size: 1, replaces: true, previousSize: 30 },
      { path: 'new.ps2', size: 1, replaces: false, previousSize: undefined },
    ]);
  });
  it('rejects filename collisions and mismatched case across platforms', () => {
    expect(() => makeFiles([entry('A.iso'), entry('a.iso')], [])).toThrow('collision');
    expect(() => makeFiles([entry('A.iso')], [entry('a.iso')])).toThrow('case conflict');
  });
  it('detects destination changes as well as source changes', () => {
    const original = fingerprint([entry('a')], [entry('a')]);
    expect(fingerprint([entry('a', 'new')], [entry('a')])).not.toBe(original);
    expect(fingerprint([entry('a')], [entry('a', 'new')])).not.toBe(original);
  });
  it('requires confirmation, refuses stale previews and never invokes deletion', async () => {
    const root = await temp(),
      store = new SettingsStore(path.join(root, 'user'), root);
    await store.load();
    await fs.mkdir(store.value.memcardsDirectory, { recursive: true });
    await fs.writeFile(path.join(store.value.memcardsDirectory, 'card.ps2'), 'save');
    const commands: string[][] = [];
    let modified = '2026-01-01';
    const remote = {
      ensureFolders: async () => {},
      remote: (kind?: string) => `test:PS2Cloud${kind ? '/' + kind : ''}`,
      list: async () => [{ Path: 'card.ps2', Size: 4, ModTime: modified }],
      call: async (args: string[]) => {
        commands.push(args);
        return '';
      },
    } as unknown as RcloneService;
    const emulator = { running: false } as PCSX2Service;
    const service = new SyncService(store, remote, new GameService(store, remote), emulator, () => {});
    const plan = await service.plan({ kind: 'Memcards', direction: 'upload' });
    await expect(service.execute(plan.id, false)).rejects.toThrow('Confirm');
    expect(commands).toHaveLength(0);
    modified = '2026-02-01';
    await expect(service.execute(plan.id, true)).rejects.toThrow('Files changed');
    expect(commands).toHaveLength(0);
    const fresh = await service.plan({ kind: 'Memcards', direction: 'upload' });
    await service.execute(fresh.id, true);
    expect(commands).toHaveLength(1);
    expect(commands[0][0]).toBe('copyto');
    expect(commands[0]).toContain('--backup-dir');
    expect(commands.flat()).not.toContain('sync');
    const cancelled = await service.plan({ kind: 'Memcards', direction: 'upload' });
    service.cancel(cancelled.id);
    await expect(service.execute(cancelled.id, true)).rejects.toThrow('expired');
  });
  it('blocks save operations while emulator is running', async () => {
    const root = await temp(),
      store = new SettingsStore(root, root);
    await store.load();
    const service = new SyncService(
      store,
      {} as RcloneService,
      {} as GameService,
      { running: true } as PCSX2Service,
      () => {},
    );
    await expect(service.plan({ kind: 'Memcards', direction: 'download' })).rejects.toThrow('Close PCSX2');
  });
});
