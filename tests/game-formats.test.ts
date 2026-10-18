import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gameExtensions, gameExtension, gameTitle, isGame } from '../shared/game-formats';
import { GameService } from '../electron/services/games';
import { SettingsStore } from '../electron/services/settings';
import { SyncService } from '../electron/services/sync';
import type { RcloneService } from '../electron/services/rclone';
import type { PCSX2Service } from '../electron/services/pcsx2';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'formats-'));
  roots.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  const directory = path.join(root, 'games');
  await fs.mkdir(directory);
  await store.save({ ...store.value, gameDirectories: [directory] });
  return { store, directory };
}
describe('PCSX2 formats', () => {
  it.each(gameExtensions)('recognizes %s case-insensitively and removes the full extension', (extension) => {
    expect(isGame(`My_Game.${extension.toUpperCase()}`)).toBe(true);
    expect(gameTitle(`My_Game.${extension}`)).toBe('My Game');
    expect(gameExtension(`My_Game.${extension.toUpperCase()}`)).toBe(extension);
  });
  it('handles compressed ISO names and excludes descriptors, archives, sidecars and partials', () => {
    expect(gameTitle('My_Game.iso.gz')).toBe('My Game');
    for (const name of [
      'disc.cue',
      'disc.toc',
      'disc.mds',
      'disc.nrg',
      'disc.zip',
      'disc.7z',
      'disc.iso.partial',
      'disc.gz.pindex.tmp',
      'bios.rom',
    ])
      expect(isGame(name)).toBe(false);
  });
  it('discovers every loadable format locally and in the cloud; transfers BIN instead of its CUE', async () => {
    const { store, directory } = await fixture();
    for (const extension of gameExtensions)
      await fs.writeFile(path.join(directory, `Local.${extension}`), extension);
    await fs.writeFile(
      path.join(directory, 'Local.cue'),
      'FILE "Local.bin" BINARY\n TRACK 01 MODE2/2352\n INDEX 01 00:00:00',
    );
    const remote = {
      status: async () => ({ connected: true }),
      ensureFolders: async () => {},
      remote: () => 'fixture:Games',
      list: async () =>
        gameExtensions.map((extension) => ({ Path: `Cloud.${extension}`, Size: 12, ModTime: '2026-01-01' })),
    } as unknown as RcloneService;
    const games = new GameService(store, remote);
    const library = await games.scan();
    expect(library.games).toHaveLength(gameExtensions.length * 2);
    expect(library.warnings).toEqual([]);
    expect(library.games.filter((game) => game.name.endsWith('.cue'))).toEqual([]);
    const binary = library.games.find((game) => game.name === 'Local.bin')!;
    const sync = new SyncService(store, remote, games, { running: false } as PCSX2Service, () => {});
    const plan = await sync.plan({ kind: 'Games', direction: 'upload', gameId: binary.id });
    expect(plan.files.map((file) => file.path)).toEqual(['Local.bin']);
    const cloudBinary = library.games.find((game) => game.name === 'Cloud.bin')!;
    const download = await sync.plan({ kind: 'Games', direction: 'download', gameId: cloudBinary.id });
    expect(download.files.map((file) => file.path)).toEqual(['Cloud.bin']);
  });
  it('explains missing CUE payloads locally and in the cloud without adding fake playable entries', async () => {
    const { store, directory } = await fixture();
    await fs.writeFile(path.join(directory, 'Missing.cue'), 'FILE "Missing.bin" BINARY\n');
    const remote = {
      status: async () => ({ connected: true }),
      ensureFolders: async () => {},
      remote: () => 'fixture:Games',
      list: async () => [{ Path: 'Missing.cue', Size: 30, ModTime: '2026-01-01' }],
    } as unknown as RcloneService;
    const library = await new GameService(store, remote).scan();
    expect(library.games).toEqual([]);
    expect(library.warnings).toHaveLength(2);
    expect(library.warnings[0]).toContain('CUE alone cannot run a game');
    expect(library.warnings[1]).toContain('BIN images');
  });
});
