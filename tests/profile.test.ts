import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PCSX2ProfileService } from '../electron/services/profile';
import { inspectBios } from '../electron/services/bios';
import { SettingsStore } from '../electron/services/settings';
import { gameLaunchArgs } from '../electron/services/pcsx2';
import { mergeIniDefaults, readIni, writeIni } from '../electron/services/ini';
import * as commands from '../electron/services/process';

const temporary: string[] = [];
const defaults =
  '[UI]\nSettingsVersion = 1\nSetupWizardIncomplete = true\n[Folders]\nBios = bios\nMemoryCards = memcards\nSavestates = sstates\n[Pad1]\nType = DualShock2\nCross = Keyboard/K\n[EmuCore]\nEnableFastBoot = true';
// Synthetic ROM-directory metadata only: zero instructions, not a usable/distributed BIOS.
function biosFixture() {
  const buffer = Buffer.alloc(512 * 1024);
  const table = 0x100;
  for (const [index, name, length] of [
    [0, 'RESET', 0x100],
    [1, 'ROMDIR', 64],
    [2, 'ROMVER', 14],
  ] as const) {
    buffer.write(name, table + index * 16, 'ascii');
    buffer.writeUInt32LE(length, table + index * 16 + 12);
  }
  buffer.write('0200EC20040614', 0x140, 'ascii');
  return buffer;
}
async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'profile-test-'));
  temporary.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  const run = vi.spyOn(commands, 'run').mockImplementation(async (_binary, args) => {
    const file = path.join(args[args.indexOf('-datapath') + 1], 'PCSX2', 'inis', 'PCSX2.ini');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, defaults);
    return '';
  });
  return { root, store, run, service: new PCSX2ProfileService(store) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('recognizes BIOS directory metadata and rejects archives, truncated data and random files', () => {
  expect(inspectBios(biosFixture())).toEqual({ region: 'Europe', version: '02.00' });
  expect(inspectBios(Buffer.alloc(4 * 1024 * 1024))).toBeUndefined();
  expect(inspectBios(Buffer.from('PK zipped BIOS'))).toBeUndefined();
  const broken = biosFixture();
  broken.writeUInt32LE(broken.length * 2, 0x100 + 12);
  expect(inspectBios(broken)).toBeUndefined();
});
it('preserves custom keys and key spacing while filling missing defaults', () => {
  const original = '[UI]\nTheme = Custom\n[Pad1]\nCross\t= Keyboard/Z\n';
  const merged = mergeIniDefaults(original, defaults);
  expect(readIni(merged, 'Pad1', 'Cross')).toBe('Keyboard/Z');
  expect(readIni(merged, 'UI', 'Theme')).toBe('Custom');
  expect(readIni(merged, 'UI', 'SettingsVersion')).toBe('1');
  expect(readIni(writeIni(merged, 'Pad1', { Cross: 'Keyboard/X' }), 'Pad1', 'Cross')).toBe('Keyboard/X');
});
it('initializes in a fresh profile, writes the actual nested INI and skips all setup UI', async () => {
  const { service, store, run } = await fixture();
  const profile = await service.prepare(process.execPath);
  const file = path.join(store.value.dataDirectory, 'PCSX2', 'inis', 'PCSX2.ini');
  const ini = await fs.readFile(file, 'utf8');
  expect(profile.directory).toBe(path.join(store.value.dataDirectory, 'PCSX2'));
  expect(profile.prepared).toBe(true);
  expect(profile.ready).toBe(false);
  expect(run.mock.calls[0][1][0]).toBe('-testconfig');
  expect(run.mock.calls[0][1][2]).not.toBe(store.value.dataDirectory);
  for (const [section, key, value] of [
    ['UI', 'SetupWizardIncomplete', 'false'],
    ['UI', 'ConfirmShutdown', 'false'],
    ['AutoUpdater', 'CheckAtStartup', 'false'],
    ['Logging', 'EnableSystemConsole', 'false'],
    ['Pad1', 'Cross', 'Keyboard/K'],
    ['Folders', 'MemoryCards', store.value.memcardsDirectory.replace(/\\/g, '/')],
  ])
    expect(readIni(ini, section, key)).toBe(value);
  await service.prepare(process.execPath);
  expect(run).toHaveBeenCalledTimes(1);
});
it('rejects missing BIOS before any emulator process starts', async () => {
  const { service, run } = await fixture();
  await expect(service.prepare(process.execPath, true)).rejects.toThrow('No valid PS2 BIOS');
  expect(run).not.toHaveBeenCalled();
});
it('validates/imports/selects BIOS and backs up an existing custom profile', async () => {
  const { service, store, root } = await fixture();
  const source = path.join(root, 'console.bin');
  await fs.writeFile(source, biosFixture());
  await service.importBios(source);
  const iniFile = path.join(store.value.dataDirectory, 'PCSX2', 'inis', 'PCSX2.ini');
  const original =
    '[UI]\nSettingsVersion = 1\nSetupWizardIncomplete = true\nTheme = MyTheme\n[Pad1]\nCross = Keyboard/Z';
  await fs.mkdir(path.dirname(iniFile), { recursive: true });
  await fs.writeFile(iniFile, original);
  const profile = await service.prepare(process.execPath, true, 'console.bin');
  expect(profile.ready).toBe(true);
  expect(profile.selectedBios).toBe('console.bin');
  const configured = await fs.readFile(iniFile, 'utf8');
  expect(readIni(configured, 'UI', 'Theme')).toBe('MyTheme');
  expect(readIni(configured, 'Pad1', 'Cross')).toBe('Keyboard/Z');
  const backup = (await fs.readdir(path.dirname(iniFile))).find((file) => file.includes('launcher-backup-'))!;
  expect(await fs.readFile(path.join(path.dirname(iniFile), backup), 'utf8')).toBe(original);
  await expect(service.prepare(process.execPath, true, '../unknown.bin')).rejects.toThrow(
    'missing or invalid',
  );
});
it('preserves save paths populated by the old setup wizard without moving files', async () => {
  const { service, store } = await fixture();
  const runtimeRoot = path.join(store.value.dataDirectory, 'PCSX2');
  const oldCards = path.join(runtimeRoot, 'memcards'),
    oldStates = path.join(runtimeRoot, 'sstates');
  for (const directory of [oldCards, oldStates]) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'user-save'), 'keep');
  }
  await service.prepare(process.execPath);
  expect(store.value.memcardsDirectory).toBe(oldCards);
  expect(store.value.saveStatesDirectory).toBe(oldStates);
  expect(await fs.readFile(path.join(oldCards, 'user-save'), 'utf8')).toBe('keep');
});
it('keeps explicitly configured populated save directories', async () => {
  const { service, store } = await fixture();
  await fs.mkdir(store.value.memcardsDirectory, { recursive: true });
  await fs.writeFile(path.join(store.value.memcardsDirectory, 'current.ps2'), 'current');
  const old = path.join(store.value.dataDirectory, 'PCSX2', 'memcards');
  await fs.mkdir(old, { recursive: true });
  await fs.writeFile(path.join(old, 'old.ps2'), 'old');
  const configured = store.value.memcardsDirectory;
  await service.prepare(process.execPath);
  expect(store.value.memcardsDirectory).toBe(configured);
});
it('uses configured portable profiles without launching an initializer into their data', async () => {
  const { service, root, run } = await fixture();
  const binary = path.join(root, 'external', 'pcsx2.exe'),
    data = path.join(root, 'portable-profile');
  await fs.mkdir(path.dirname(binary));
  await fs.writeFile(binary, 'binary fixture');
  await fs.writeFile(path.join(path.dirname(binary), 'portable.txt'), data);
  await fs.mkdir(path.join(data, 'inis'), { recursive: true });
  await fs.writeFile(path.join(data, 'inis', 'PCSX2.ini'), defaults);
  await service.prepare(binary);
  expect(run).not.toHaveBeenCalled();
  expect((await service.inspect(binary)).directory).toBe(data);
});
it('launches only a game display with argument-array-safe paths', () => {
  const args = gameLaunchArgs('D:/PS2 Data', 'D:/Games/--disc name.iso', true);
  expect(args).toEqual([
    '-datapath',
    'D:/PS2 Data',
    '-nogui',
    '-fullscreen',
    '--',
    'D:/Games/--disc name.iso',
  ]);
  expect(gameLaunchArgs('/games/data', '/games/disc.chd', false)).toContain('-nofullscreen');
  expect(args).not.toContain('-portable');
});
