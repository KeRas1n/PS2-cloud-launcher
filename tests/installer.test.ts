import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SettingsStore } from '../electron/services/settings';
import { PCSX2Service } from '../electron/services/pcsx2';
import * as downloads from '../electron/services/download';

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'installer-'));
  temporary.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  vi.spyOn(downloads, 'trustedFetch').mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v2.8.2',
          prerelease: false,
          assets: [
            { name: 'pcsx2-windows-x64-Qt.7z', browser_download_url: 'https://github.com/fixture/windows' },
            { name: 'pcsx2-linux-x64.AppImage', browser_download_url: 'https://github.com/fixture/linux' },
          ],
        }),
      ),
  );
  vi.spyOn(downloads, 'download').mockImplementation(async (_url, archive) => {
    await fs.writeFile(archive, 'executable fixture');
  });
  const extract = vi.spyOn(downloads, 'extract').mockImplementation(async (_archive, destination) => {
    await fs.mkdir(path.join(destination, 'bin'), { recursive: true });
    await fs.writeFile(path.join(destination, 'bin', 'pcsx2-qt.exe'), 'executable fixture');
  });
  return { store, extract, service: new PCSX2Service(store, () => {}) };
}

it('installs and updates when Windows-style directory renames are denied', async () => {
  const { store, service } = await fixture();
  const originalRename = fs.rename.bind(fs);
  const directoryRenames: string[] = [];
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    if ((await fs.stat(source)).isDirectory()) {
      directoryRenames.push(String(source));
      throw Object.assign(new Error('EPERM: directory rename denied'), { code: 'EPERM' });
    }
    await originalRename(source, destination);
  });
  const preserved = [
    path.join(store.value.biosDirectory, 'bios.test'),
    path.join(store.value.memcardsDirectory, 'card.ps2'),
    path.join(store.value.saveStatesDirectory, 'save.p2s'),
    path.join(store.value.dataDirectory, 'inis', 'PCSX2.ini'),
  ];
  for (const file of preserved) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'original user data');
  }
  const first = await service.install();
  const second = await service.install();
  expect(first.installed).toBe(true);
  expect(second.managed).toBe(true);
  expect(second.path).not.toBe(first.path);
  expect(await fs.readFile(first.path!, 'utf8')).toBe('executable fixture');
  expect(await fs.readFile(second.path!, 'utf8')).toBe('executable fixture');
  for (const file of preserved) expect(await fs.readFile(file, 'utf8')).toBe('original user data');
  expect(
    JSON.parse(await fs.readFile(path.join(store.value.emulatorRoot, 'installed.json'), 'utf8')).path,
  ).toBe(second.path);
  expect(directoryRenames).toEqual([]);
});

it('keeps the working version active if a new extraction fails', async () => {
  const { store, service, extract } = await fixture();
  const installed = await service.install();
  const manifestFile = path.join(store.value.emulatorRoot, 'installed.json');
  const manifest = await fs.readFile(manifestFile, 'utf8');
  const error = new Error('Extraction failed');
  if (process.platform === 'win32') extract.mockRejectedValueOnce(error);
  else vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(error);
  await expect(service.install()).rejects.toThrow('Extraction failed');
  expect(await fs.readFile(manifestFile, 'utf8')).toBe(manifest);
  expect(store.value.pcsx2Path).toBe(installed.path);
  expect(await fs.readFile(installed.path!, 'utf8')).toBe('executable fixture');
  expect(await fs.readdir(path.join(store.value.emulatorRoot, 'versions'))).toHaveLength(1);
});

it('does not report a failed install when Windows temporarily blocks staging cleanup', async () => {
  const { service } = await fixture();
  const originalRemove = fs.rm.bind(fs);
  vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
    if (path.basename(String(target)).startsWith('.install-')) {
      throw Object.assign(new Error('EPERM: cleanup denied'), { code: 'EPERM' });
    }
    await originalRemove(target, options);
  });
  const first = await service.install();
  const second = await service.install();
  expect(first.installed).toBe(true);
  expect(second.installed).toBe(true);
  expect(second.path).not.toBe(first.path);
});
