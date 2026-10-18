import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { EmulatorStatus, Progress } from '../../shared/types';
import { SettingsStore } from './settings';
import { exists, atomicJson, walk } from './files';
import { run } from './process';
import { trustedFetch, download, extract } from './download';

interface Install {
  path: string;
  version: string;
}
interface Release {
  tag_name: string;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; digest?: string }[];
}
export function selectAsset(release: Release, platform: string, arch: string) {
  if (arch !== 'x64')
    throw new Error(
      'Automatic PCSX2 installation requires x86-64. Configure a compatible PCSX2 executable manually.',
    );
  const candidates = release.assets.filter((a) =>
    platform === 'win32'
      ? /windows.*(?:x64|avx2|sse4).*\.(?:7z|zip)$/i.test(a.name) && !/symbols|pdb|installer/i.test(a.name)
      : /linux.*appimage$/i.test(a.name) && !/symbols|arm|aarch/i.test(a.name),
  );
  candidates.sort((a, b) => Number(/avx2/i.test(a.name)) - Number(/avx2/i.test(b.name)));
  if (!candidates[0])
    throw new Error(
      'No compatible portable asset found in the latest stable PCSX2 release. Choose an executable in Settings.',
    );
  return candidates[0];
}
export function updateFolders(ini: string, folders: Record<string, string>): string {
  const lines = ini.split(/\r?\n/);
  let start = lines.findIndex((l) => l.trim().toLowerCase() === '[folders]');
  if (start < 0) {
    lines.push('', '[Folders]');
    start = lines.length - 1;
  }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  const section = lines.slice(start + 1, end).filter(
    (l) =>
      !Object.keys(folders).some(
        (k) =>
          l
            .trim()
            .toLowerCase()
            .startsWith(k.toLowerCase() + ' =') ||
          l
            .trim()
            .toLowerCase()
            .startsWith(k.toLowerCase() + '='),
      ),
  );
  lines.splice(
    start + 1,
    end - start - 1,
    ...section,
    ...Object.entries(folders).map(([k, v]) => `${k} = ${v.replace(/\\/g, '/')}`),
  );
  return lines.join('\n');
}
export class PCSX2Service {
  private child?: ChildProcess;
  private installing = false;
  constructor(
    private store: SettingsStore,
    private emit: (p: Progress) => void,
  ) {}
  get running() {
    return !!this.child;
  }
  private async manifest(): Promise<Install | undefined> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.store.value.emulatorRoot, 'installed.json'), 'utf8'),
      );
    } catch {
      return undefined;
    }
  }
  async status(): Promise<EmulatorStatus> {
    const s = this.store.value,
      installed = await this.manifest();
    const candidates = [
      s.pcsx2Path,
      installed?.path,
      ...(process.env.PATH ?? '')
        .split(path.delimiter)
        .map((p) => path.join(p, process.platform === 'win32' ? 'pcsx2-qt.exe' : 'pcsx2-qt')),
      process.platform === 'win32'
        ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PCSX2', 'pcsx2-qt.exe')
        : '/usr/bin/pcsx2',
    ];
    for (const candidate of candidates) {
      if (candidate && (await exists(candidate))) {
        let version = candidate === installed?.path ? installed.version : undefined;
        if (!version) {
          try {
            version = (await run(candidate, ['-version'], { timeout: 10_000 })).trim().slice(0, 150);
          } catch {
            version = 'External installation';
          }
        }
        return {
          installed: true,
          path: candidate,
          version,
          running: this.running,
          managed: candidate === installed?.path,
        };
      }
    }
    return { installed: false, running: this.running, managed: false };
  }
  async install() {
    if (this.installing || this.running)
      throw new Error('Close PCSX2 and wait for the current installation first.');
    if (!['win32', 'linux'].includes(process.platform))
      throw new Error('Supported platforms: Windows and Linux.');
    this.installing = true;
    const root = this.store.value.emulatorRoot;
    const staging = path.join(root, `.install-${randomUUID()}`);
    try {
      this.emit({ operation: 'emulator', message: 'Checking latest stable PCSX2 release' });
      const release = (await (
        await trustedFetch('https://api.github.com/repos/PCSX2/pcsx2/releases/latest')
      ).json()) as Release;
      if (release.prerelease || !/^v?[\w.-]+$/.test(release.tag_name))
        throw new Error('Invalid stable release metadata.');
      const asset = selectAsset(release, process.platform, process.arch);
      await fs.mkdir(staging, { recursive: true });
      const archive = path.join(staging, path.basename(asset.name));
      await download(asset.browser_download_url, archive, 'emulator', this.emit, asset.digest);
      const payload = path.join(staging, 'payload');
      if (process.platform === 'linux') {
        await fs.mkdir(payload);
        await fs.rename(archive, path.join(payload, 'pcsx2.AppImage'));
        await fs.chmod(path.join(payload, 'pcsx2.AppImage'), 0o755);
      } else {
        this.emit({ operation: 'emulator', message: 'Extracting PCSX2' });
        await extract(archive, payload);
      }
      const executable = (await walk(payload)).find(
        (f) => /(?:pcsx2.*\.exe|pcsx2\.AppImage)$/i.test(path.basename(f.path)) && !/uninstall/i.test(f.path),
      );
      if (!executable) throw new Error('PCSX2 executable missing from release.');
      const destination = path.join(root, 'versions', `${release.tag_name}-${randomUUID().slice(0, 8)}`);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(payload, destination);
      const installed = { path: path.join(destination, executable.path), version: release.tag_name };
      await atomicJson(path.join(root, 'installed.json'), installed);
      await this.store.save({ ...this.store.value, pcsx2Path: installed.path });
      this.emit({
        operation: 'emulator',
        message: `PCSX2 ${release.tag_name} installed. Existing data preserved.`,
        percent: 100,
      });
      return this.status();
    } finally {
      this.installing = false;
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
  async launch(game?: string) {
    if (this.running || this.installing) throw new Error('PCSX2 is already running or being installed.');
    const status = await this.status();
    if (!status.path) throw new Error('Install PCSX2 or select its executable in Settings.');
    const s = this.store.value;
    for (const dir of [
      s.dataDirectory,
      s.biosDirectory,
      s.memcardsDirectory,
      s.saveStatesDirectory,
      path.join(s.dataDirectory, 'inis'),
    ])
      await fs.mkdir(dir, { recursive: true });
    const iniFile = path.join(s.dataDirectory, 'inis', 'PCSX2.ini');
    const ini = (await exists(iniFile)) ? await fs.readFile(iniFile, 'utf8') : '';
    if (ini) await fs.copyFile(iniFile, `${iniFile}.launcher-backup`);
    await fs.writeFile(
      iniFile,
      updateFolders(ini, {
        Bios: s.biosDirectory,
        MemoryCards: s.memcardsDirectory,
        Savestates: s.saveStatesDirectory,
      }),
    );
    const args = [
      '-datapath',
      s.dataDirectory,
      ...(game ? ['-batch', ...(s.fullscreen ? ['-fullscreen'] : []), '--', game] : []),
    ];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(status.path!, args, {
        cwd: path.dirname(status.path!),
        shell: false,
        stdio: 'ignore',
      });
      this.child = child;
      child.once('spawn', resolve);
      child.once('error', (error) => {
        this.child = undefined;
        reject(error);
      });
      child.once('exit', (code) => {
        this.child = undefined;
        this.emit({
          operation: 'emulator',
          message: code
            ? `PCSX2 exited with code ${code}. Check BIOS and system dependencies.`
            : 'PCSX2 closed',
        });
      });
    });
  }
}
