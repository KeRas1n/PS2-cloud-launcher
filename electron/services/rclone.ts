import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CloudStatus, Progress, SyncKind } from '../../shared/types';
import { SettingsStore } from './settings';
import { run } from './process';
import { download, extract, trustedFetch } from './download';
import { safeRelative, walk } from './files';

export interface RemoteFile {
  Path: string;
  Size: number;
  ModTime: string;
  IsDir: boolean;
}
export class RcloneService {
  private authorizing = false;
  private installing = false;
  constructor(
    private store: SettingsStore,
    private emit: (p: Progress) => void,
  ) {}
  call(args: string[], progress = false, oauth = false) {
    const s = this.store.value;
    return run(
      s.rclonePath,
      [
        ...args,
        '--config',
        s.rcloneConfig,
        ...(progress
          ? ['--use-json-log', '--stats', '1s', '--stats-one-line', '--stats-log-level', 'NOTICE']
          : []),
      ],
      {
        timeout: oauth ? 300_000 : progress ? 24 * 60 * 60 * 1000 : 120_000,
        privateOutput: oauth,
        onLine: progress
          ? (line) => {
              try {
                const data = JSON.parse(line);
                if (data.stats)
                  this.emit({
                    operation: 'sync',
                    message: 'Transferring files',
                    bytes: data.stats.bytes,
                    totalBytes: data.stats.totalBytes,
                    speed: data.stats.speed,
                    percent: data.stats.totalBytes
                      ? (data.stats.bytes / data.stats.totalBytes) * 100
                      : undefined,
                  });
              } catch {
                /* Rclone may emit non-JSON diagnostics; command failure reports them. */
              }
            }
          : undefined,
      },
    );
  }
  remote(kind?: SyncKind) {
    const s = this.store.value;
    return `${s.remote}:${[s.cloudRoot, kind].filter(Boolean).join('/')}`;
  }
  async list(location: string): Promise<RemoteFile[]> {
    const result = JSON.parse(await this.call(['lsjson', location, '--recursive', '--files-only']));
    if (!Array.isArray(result)) throw new Error('Invalid file list returned by Rclone.');
    return result.map((f: RemoteFile) => {
      safeRelative(f.Path);
      if (!Number.isSafeInteger(f.Size) || f.Size < 0 || typeof f.ModTime !== 'string')
        throw new Error('Invalid cloud file metadata.');
      return f;
    });
  }
  async status(): Promise<CloudStatus> {
    let version: string;
    try {
      version = (await this.call(['version'])).split(/\r?\n/)[0];
    } catch {
      return {
        installed: false,
        connected: false,
        remotes: [],
        error: 'Rclone not found. Install it below or choose its executable in Settings.',
      };
    }
    let remotes: string[] = [];
    try {
      remotes = (await this.call(['listremotes']))
        .split(/\r?\n/)
        .filter(Boolean)
        .map((s) => s.replace(/:$/, ''));
      if (!remotes.includes(this.store.value.remote))
        return { installed: true, version, connected: false, remotes };
      // lsd checks access without creating or modifying cloud data.
      await this.call(['lsd', `${this.store.value.remote}:`, '--max-depth', '1']);
      return { installed: true, version, connected: true, remotes };
    } catch (error) {
      return { installed: true, version, connected: false, remotes, error: (error as Error).message };
    }
  }
  async ensureFolders() {
    for (const kind of ['Games', 'Memcards', 'SaveStates'] as const)
      await this.call(['mkdir', this.remote(kind)]);
  }
  async connect() {
    if (this.authorizing)
      throw new Error('Dropbox connection is already in progress. Finish authorization in your browser.');
    this.authorizing = true;
    try {
      await fs.mkdir(path.dirname(this.store.value.rcloneConfig), { recursive: true, mode: 0o700 });
      const names = (await this.call(['listremotes'])).split(/\r?\n/);
      this.emit({
        operation: 'cloud',
        message: 'Approve Dropbox access in your browser. This may take a few minutes.',
      });
      if (names.includes(this.store.value.remote + ':')) {
        // Check backend without ever reading or returning the token-bearing config.
        const providers = JSON.parse(await this.call(['listremotes', '--json'])) as {
          name: string;
          type: string;
        }[];
        if (!providers.some((p) => p.name === this.store.value.remote && p.type === 'dropbox'))
          throw new Error('Selected remote is not Dropbox. Choose a new remote name in Settings.');
        await this.call(
          ['config', 'reconnect', this.store.value.remote + ':', '--auto-confirm'],
          false,
          true,
        );
      } else {
        await this.call(
          ['config', 'create', this.store.value.remote, 'dropbox', 'config_is_local', 'true', '--no-output'],
          false,
          true,
        );
      }
      if (process.platform !== 'win32') await fs.chmod(this.store.value.rcloneConfig, 0o600);
      await this.ensureFolders();
      const status = await this.status();
      if (!status.connected) throw new Error(status.error ?? 'Dropbox authorization did not complete.');
      return status;
    } finally {
      this.authorizing = false;
    }
  }
  async install() {
    if (this.installing) throw new Error('Rclone installation is already in progress.');
    if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64')
      throw new Error(
        'Automatic Rclone installation supports Windows/Linux x86-64. Install Rclone manually and configure its path.',
      );
    this.installing = true;
    const root = path.join(this.store.userData, 'tools', `rclone-${randomUUID()}`);
    try {
      const os = process.platform === 'win32' ? 'windows' : 'linux';
      const version = (await (await trustedFetch('https://downloads.rclone.org/version.txt')).text())
        .trim()
        .replace(/^rclone\s+/, '');
      if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Rclone release version.');
      const archiveName = `rclone-${version}-${os}-amd64.zip`;
      const archive = path.join(root, archiveName);
      const checksums = await (
        await trustedFetch(`https://downloads.rclone.org/${version}/SHA256SUMS`)
      ).text();
      const checksum = checksums
        .split(/\r?\n/)
        .find((line) => line.trim().endsWith(archiveName))
        ?.trim()
        .split(/\s+/)[0];
      if (!checksum || !/^[a-fA-F0-9]{64}$/.test(checksum))
        throw new Error('Official Rclone checksum not found.');
      await download(
        `https://downloads.rclone.org/${version}/${archiveName}`,
        archive,
        'rclone',
        this.emit,
        `sha256:${checksum.toLowerCase()}`,
      );
      await extract(archive, path.join(root, 'bin'));
      const executable = (await walk(path.join(root, 'bin'))).find(
        (f) => path.basename(f.path) === (os === 'windows' ? 'rclone.exe' : 'rclone'),
      );
      if (!executable) throw new Error('Rclone executable missing from release.');
      if (process.platform !== 'win32') await fs.chmod(executable.absolute, 0o755);
      await run(executable.absolute, ['version']);
      await this.store.save({ ...this.store.value, rclonePath: executable.absolute });
      await fs.rm(archive, { force: true });
      this.emit({ operation: 'rclone', message: 'Rclone installed', percent: 100 });
    } finally {
      this.installing = false;
    }
  }
}
