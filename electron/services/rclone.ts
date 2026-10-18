import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { CloudStatus, MegaCredentials, Progress, SyncKind } from '../../shared/types';
import { SettingsStore } from './settings';
import { run } from './process';
import { download, extract, trustedFetch } from './download';
import { atomicText, exists, safeRelative, walk } from './files';
import { RcloneRemoteControl, sampleTransfer } from './rclone-rc';
import { TransferLog, transferDiagnostic } from './transfer-log';

export interface RemoteFile {
  Path: string;
  Size: number;
  ModTime: string;
  IsDir: boolean;
}
export class RcloneService {
  private authorizing = false;
  private installing = false;
  private control: RcloneRemoteControl;
  private log: TransferLog;
  private megaCode?: string;
  constructor(
    private store: SettingsStore,
    private emit: (p: Progress) => void,
    private bundledPath?: string,
  ) {
    this.log = new TransferLog(store.userData);
    this.control = new RcloneRemoteControl((event) => this.log.write(event));
  }
  async transferLogDirectory() {
    await fs.mkdir(this.log.directory, { recursive: true, mode: 0o700 });
    await this.log.flush();
    return this.log.directory;
  }
  dispose() {
    this.control.dispose();
    this.megaCode = undefined;
  }
  private async binary() {
    return this.bundledPath && (await exists(this.bundledPath))
      ? this.bundledPath
      : this.store.value.rclonePath;
  }
  async call(args: string[], progress: boolean | ((progress: Progress) => void) = false, oauth = false) {
    if (!['copy', 'copyto'].includes(args[0])) return this.invoke(args, progress, oauth);
    const id = randomUUID(),
      started = performance.now();
    const provider = this.store.value.cloudProvider;
    let latest: Progress | undefined;
    this.log.write({
      event: 'transfer-start',
      id,
      provider,
      transport: provider === 'mega' ? 'rc' : 'cli',
      command: args[0],
      source: path.isAbsolute(args[1]) ? 'local' : 'cloud',
      destination: path.isAbsolute(args[2]) ? 'local' : 'cloud',
      fileId: createHash('sha256').update(args[1]).digest('hex').slice(0, 16),
    });
    try {
      const result = await this.invoke(
        args,
        (p) => {
          latest = p;
          if (provider !== 'mega')
            this.log.write({
              event: 'transfer-sample',
              id,
              bytes: p.bytes,
              totalBytes: p.totalBytes,
              speed: p.speed,
              elapsedSeconds: (performance.now() - started) / 1000,
            });
          if (progress) (typeof progress === 'function' ? progress : this.emit)(p);
        },
        oauth,
      );
      const seconds = (performance.now() - started) / 1000;
      this.log.write({
        event: 'transfer-finish',
        id,
        success: true,
        bytes: latest?.bytes,
        elapsedSeconds: seconds,
        averageSpeed: seconds ? (latest?.bytes ?? 0) / seconds : 0,
      });
      return result;
    } catch (error) {
      this.log.write({
        event: 'transfer-finish',
        id,
        success: false,
        bytes: latest?.bytes,
        elapsedSeconds: (performance.now() - started) / 1000,
      });
      throw error;
    } finally {
      await this.log.flush().catch(() => {});
    }
  }
  private async invoke(args: string[], progress: boolean | ((progress: Progress) => void), oauth: boolean) {
    const s = this.store.value;
    const started = performance.now();
    let previous = { bytes: 0, time: started };
    if (s.cloudProvider === 'mega' && ['lsjson', 'lsd', 'mkdir', 'copy', 'copyto'].includes(args[0]))
      return this.control.command(
        await this.binary(),
        s.rcloneConfig,
        this.megaCode,
        args,
        progress ? (typeof progress === 'function' ? progress : this.emit) : undefined,
      );
    return run(
      await this.binary(),
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
              const diagnostic = transferDiagnostic(line);
              if (diagnostic) this.log.write(diagnostic);
              try {
                const data = JSON.parse(line);
                if (data.stats) {
                  const now = performance.now();
                  const sample = sampleTransfer(data.stats, previous, now, started);
                  previous = { bytes: sample.bytes ?? 0, time: now };
                  (typeof progress === 'function' ? progress : this.emit)(sample);
                }
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
        error: 'Cloud component is unavailable. Click Connect to prepare it automatically.',
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
  async connect(credentials?: MegaCredentials) {
    if (this.authorizing) throw new Error('Cloud connection is already in progress.');
    this.authorizing = true;
    try {
      if (!(await this.status()).installed) await this.install();
      await fs.mkdir(path.dirname(this.store.value.rcloneConfig), { recursive: true, mode: 0o700 });
      if (this.store.value.cloudProvider === 'mega') return await this.connectMega(credentials);
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
  private async connectMega(credentials?: MegaCredentials) {
    const s = this.store.value;
    const providers = JSON.parse(await this.call(['listremotes', '--json'])) as {
      name: string;
      type: string;
    }[];
    const existing = providers.find((p) => p.name === s.remote);
    if (existing && existing.type !== 'mega')
      throw new Error('Selected remote is not MEGA. Choose another remote name in Advanced cloud settings.');
    if (!existing && !credentials) throw new Error('Enter your MEGA email and password.');
    this.control.dispose();
    this.megaCode = credentials?.code;
    let previous: string | undefined;
    if (credentials) {
      try {
        previous = await fs.readFile(s.rcloneConfig, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    try {
      this.emit({ operation: 'cloud', message: 'Connecting to MEGA…' });
      // Clear cached account keys when replacing a MEGA login. Otherwise an old
      // session_id/master_key could authenticate the previous account instead.
      if (credentials && existing)
        await this.control.request(await this.binary(), s.rcloneConfig, this.megaCode, 'config/delete', {
          name: s.remote,
        });
      if (credentials)
        await this.control.request(await this.binary(), s.rcloneConfig, this.megaCode, 'config/create', {
          name: s.remote,
          type: 'mega',
          parameters: { user: credentials.email, pass: credentials.password, use_https: 'true' },
          opt: { obscure: true, noOutput: true, nonInteractive: true },
        });
      await this.call(['lsd', `${s.remote}:`, '--max-depth', '1']);
      if (process.platform !== 'win32') await fs.chmod(s.rcloneConfig, 0o600);
      await this.ensureFolders();
      const status = await this.status();
      if (!status.connected) throw new Error('MEGA connection check failed.');
      return status;
    } catch {
      this.dispose();
      // Failed sign-in must not replace a previously working saved MEGA connection.
      if (credentials) {
        if (previous !== undefined) await atomicText(s.rcloneConfig, previous);
        else await fs.rm(s.rcloneConfig, { force: true });
      }
      throw new Error(
        'MEGA sign-in failed. Check email, password and two-factor code. For a new account, first sign in at mega.nz in your browser.',
      );
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
