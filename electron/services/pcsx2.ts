import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { EmulatorStatus, Progress } from '../../shared/types';
import { SettingsStore } from './settings';
import { exists, atomicJson, walk } from './files';
import { run } from './process';
import { trustedFetch, download, extract } from './download';
import { writeIni } from './ini';
import { PCSX2ProfileService } from './profile';

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
  return writeIni(
    ini,
    'Folders',
    Object.fromEntries(Object.entries(folders).map(([key, value]) => [key, value.replace(/\\/g, '/')])),
  );
}
export function gameLaunchArgs(dataDirectory: string, game: string, fullscreen: boolean) {
  return ['-datapath', dataDirectory, '-nogui', fullscreen ? '-fullscreen' : '-nofullscreen', '--', game];
}
export class PCSX2Service {
  gamePath?: string;
  private child?: ChildProcess;
  private installing = false;
  readonly profiles: PCSX2ProfileService;
  constructor(
    private store: SettingsStore,
    private emit: (p: Progress) => void,
    private onClosed?: () => void,
  ) {
    this.profiles = new PCSX2ProfileService(store);
  }
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
    const candidates = [s.pcsx2Path, installed?.path];
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
          profile: await this.profiles.inspect(candidate),
        };
      }
    }
    return {
      installed: false,
      running: this.running,
      managed: false,
      profile: await this.profiles.inspect(),
    };
  }
  async install() {
    if (this.installing || this.running)
      throw new Error('Close PCSX2 and wait for the current installation first.');
    if (!['win32', 'linux'].includes(process.platform))
      throw new Error('Supported platforms: Windows and Linux.');
    this.installing = true;
    const root = this.store.value.emulatorRoot;
    const staging = path.join(root, `.install-${randomUUID()}`);
    let destination: string | undefined;
    let published = false;
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
      const versionDirectory = path.join(root, 'versions', `${release.tag_name}-${randomUUID()}`);
      await fs.mkdir(path.dirname(versionDirectory), { recursive: true });
      // Extract directly into a fresh version. Windows may deny renaming a directory
      // containing newly extracted executables even after the extractor has exited.
      await fs.mkdir(versionDirectory);
      destination = versionDirectory;
      if (process.platform === 'linux') {
        await fs.copyFile(archive, path.join(destination, 'pcsx2.AppImage'));
        await fs.chmod(path.join(destination, 'pcsx2.AppImage'), 0o755);
      } else {
        this.emit({ operation: 'emulator', message: 'Extracting PCSX2' });
        await extract(archive, destination);
      }
      const executable = (await walk(destination)).find(
        (f) => /(?:pcsx2.*\.exe|pcsx2\.AppImage)$/i.test(path.basename(f.path)) && !/uninstall/i.test(f.path),
      );
      if (!executable) throw new Error('PCSX2 executable missing from release.');
      const installed = { path: path.join(destination, executable.path), version: release.tag_name };
      await atomicJson(path.join(root, 'installed.json'), installed);
      published = true;
      await this.store.save({ ...this.store.value, pcsx2Path: installed.path });
      this.emit({
        operation: 'emulator',
        message: `PCSX2 ${release.tag_name} installed. Existing data preserved.`,
        percent: 100,
      });
      return this.status();
    } finally {
      this.installing = false;
      // Cleanup must not turn a successful install into an error or hide the
      // original extraction failure. Only directories created by this attempt
      // are eligible; existing versions and persistent data are never removed.
      for (const directory of [staging, ...(!published && destination ? [destination] : [])]) {
        try {
          await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
          // A locked temporary directory can remain safely; retries use a new UUID.
        }
      }
    }
  }
  async prepare(selectedBios?: string) {
    if (this.running || this.installing) throw new Error('Close PCSX2 before changing its profile.');
    const status = await this.status();
    if (!status.path) throw new Error('Install PCSX2 or select its executable in Settings.');
    await this.profiles.prepare(status.path, false, selectedBios);
  }
  async launch(game?: string) {
    // Retain compatibility with older renderer code without opening emulator UI.
    if (!game) return this.prepare();
    if (this.running || this.installing) throw new Error('PCSX2 is already running or being installed.');
    const status = await this.status();
    if (!status.path) throw new Error('Install PCSX2 or select its executable in Settings.');
    if (!(await exists(game))) throw new Error('Game file is missing. Refresh the library.');
    await this.profiles.prepare(status.path, true);
    const s = this.store.value;
    const args = gameLaunchArgs(s.dataDirectory, game, s.fullscreen);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(status.path!, args, {
        cwd: path.dirname(status.path!),
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      this.child = child;
      this.gamePath = game;
      child.once('spawn', () => {
        this.emit({ operation: 'emulator', message: 'PCSX2 started', emulatorRunning: true });
        resolve();
      });
      child.once('error', (error) => {
        this.child = undefined;
        this.gamePath = undefined;
        reject(error);
      });
      child.once('exit', (code) => {
        this.child = undefined;
        this.gamePath = undefined;
        this.emit({
          operation: 'emulator',
          emulatorRunning: false,
          message: code
            ? `PCSX2 exited with code ${code}. Check BIOS and system dependencies.`
            : 'PCSX2 closed',
        });
        this.onClosed?.();
      });
    });
  }
}
