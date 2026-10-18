import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Progress } from '../../shared/types';
import { transferDiagnostic, type TransferEvent } from './transfer-log';

export const megaTransferFlags = [
  '--mega-use-https',
  '--bwlimit',
  'off',
  '--bwlimit-file',
  'off',
  '--tpslimit',
  '0',
  '--transfers',
  '4',
  '--checkers',
  '8',
  '--multi-thread-streams',
  '4',
  '--multi-thread-cutoff',
  '64Mi',
  '--multi-thread-chunk-size',
  '16Mi',
];

export function sampleTransfer(
  stats: { bytes?: number; totalBytes?: number; speed?: number },
  previous: { bytes: number; time: number },
  now: number,
  started: number,
): Progress {
  const bytes = Math.max(0, stats.bytes ?? 0),
    seconds = (now - previous.time) / 1000;
  return {
    operation: 'sync',
    message: 'Transferring files',
    bytes,
    totalBytes: stats.totalBytes,
    speed: seconds > 0 ? Math.max(0, bytes - previous.bytes) / seconds : 0,
    averageSpeed: now > started ? bytes / ((now - started) / 1000) : 0,
    percent: stats.totalBytes ? (bytes / stats.totalBytes) * 100 : undefined,
  };
}

export function splitLocation(location: string) {
  if (path.isAbsolute(location)) return { fs: path.dirname(location), remote: path.basename(location) };
  const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]*:)(.*)$/.exec(location);
  if (!match) throw new Error('Invalid cloud location.');
  return { fs: match[1], remote: match[2] };
}
export function splitFileLocation(location: string) {
  const result = splitLocation(location);
  if (path.isAbsolute(location)) return result;
  const directory = path.posix.dirname(result.remote);
  return { fs: result.fs + (directory === '.' ? '' : directory), remote: path.posix.basename(result.remote) };
}

// One authenticated, loopback-only daemon keeps MEGA's login session cached across operations.
// No daemon address, credentials or arbitrary RC endpoint is exposed to the renderer.
export class RcloneRemoteControl {
  constructor(private record: (event: TransferEvent) => void = () => {}) {}
  private child?: ChildProcess;
  private ready?: Promise<string>;
  private key = '';
  private password = '';
  private stopping = false;
  private closing: Promise<void> = Promise.resolve();
  async closed() {
    await this.closing;
  }
  dispose() {
    this.stopping = true;
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      this.closing = new Promise<void>((resolve) => child.once('close', () => resolve()));
      child.kill();
    }
    this.child = undefined;
    this.ready = undefined;
    this.key = '';
    this.password = '';
  }
  private start(binary: string, config: string, code?: string) {
    const key = JSON.stringify([binary, config, code]);
    if (this.ready && this.key === key) return this.ready;
    this.dispose();
    this.stopping = false;
    this.key = key;
    this.password = randomBytes(32).toString('hex');
    this.ready = new Promise<string>((resolve, reject) => {
      const child = spawn(
        binary,
        [
          'rcd',
          '--config',
          config,
          '--rc-addr',
          '127.0.0.1:0',
          '--rc-no-auth=false',
          ...megaTransferFlags,
          '--use-json-log',
          '--log-level',
          'DEBUG',
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            RCLONE_RC_USER: 'launcher',
            RCLONE_RC_PASS: this.password,
            RCLONE_MEGA_2FA: code ?? '',
          },
        },
      );
      this.child = child;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Cloud component did not start. Retry connection.'));
      }, 15_000);
      let output = '';
      let pending = '';
      let announced = false;
      child.stdout?.resume();
      child.stderr?.on('data', (chunk) => {
        output = (output + chunk.toString()).slice(-4096);
        pending += chunk.toString();
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          const diagnostic = transferDiagnostic(pending.slice(0, end));
          if (diagnostic) this.record(diagnostic);
          pending = pending.slice(end + 1);
        }
        if (pending.length > 64 * 1024) pending = '';
        const address = /Serving remote control on (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
        if (address && !announced) {
          announced = true;
          clearTimeout(timer);
          resolve(address[1]);
          this.record({
            event: 'mega-runtime',
            https: true,
            bandwidthLimit: 'off',
            fileBandwidthLimit: 'off',
            tpsLimit: 0,
            streams: 4,
            cutoffBytes: 64 * 1024 * 1024,
            chunkBytes: 16 * 1024 * 1024,
          });
        }
      });
      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not start cloud component.'));
      });
      child.once('close', () => {
        clearTimeout(timer);
        if (this.child === child) {
          this.child = undefined;
          this.ready = undefined;
        }
        reject(new Error('Cloud component stopped. Retry connection.'));
      });
    });
    // A rejected startup is retryable, including synchronous spawn failures.
    void this.ready.catch(() => {
      if (this.key === key) this.dispose();
    });
    return this.ready;
  }
  async request(
    binary: string,
    config: string,
    code: string | undefined,
    endpoint: string,
    parameters: object = {},
    timeout = 120_000,
  ): Promise<any> {
    const address = await this.start(binary, config, code);
    const response = await fetch(new URL(endpoint, address), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`launcher:${this.password}`).toString('base64')}`,
      },
      body: JSON.stringify(parameters),
      signal: AbortSignal.timeout(timeout),
    });
    // RC errors may echo their input, including config passwords. Never expose their bodies.
    if (!response.ok) {
      this.record({ event: 'api-error', endpoint, httpStatus: response.status });
      throw new Error(
        'MEGA operation failed. Check your connection, account, transfer quota and two-factor code, then reconnect.',
      );
    }
    return response.json();
  }
  async command(
    binary: string,
    config: string,
    code: string | undefined,
    args: string[],
    progress?: (p: Progress) => void,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const abort = () => this.dispose();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await this.execute(binary, config, code, args, progress);
    } catch (error) {
      if (signal?.aborted) {
        await this.closed();
        throw new DOMException('Transfer cancelled.', 'AbortError');
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  private async execute(
    binary: string,
    config: string,
    code: string | undefined,
    args: string[],
    progress?: (p: Progress) => void,
  ) {
    const request = (endpoint: string, parameters: object = {}, timeout?: number) =>
      this.request(binary, config, code, endpoint, parameters, timeout);
    const [command, from, to] = args;
    if (command === 'lsjson' || command === 'lsd') {
      const result = await request('operations/list', {
        fs: from,
        remote: '',
        opt: {
          recurse: command === 'lsjson',
          filesOnly: command === 'lsjson',
          dirsOnly: command === 'lsd',
        },
      });
      return JSON.stringify(result.list);
    }
    if (command === 'mkdir') {
      await request('operations/mkdir', splitLocation(from));
      return '';
    }
    if (command === 'deletefile') {
      await request('operations/deletefile', splitFileLocation(from));
      return '';
    }
    if (!['copy', 'copyto', 'moveto'].includes(command)) throw new Error('Unsupported cloud operation.');
    const backupIndex = args.indexOf('--backup-dir');
    const options = {
      IgnoreTimes: args.includes('--ignore-times'),
      ...(backupIndex < 0 ? {} : { BackupDir: args[backupIndex + 1] }),
      ...(args.includes('--inplace') ? { Inplace: true } : {}),
    };
    for (const [flag, key] of [
      ['--multi-thread-streams', 'MultiThreadStreams'],
      ['--multi-thread-cutoff', 'MultiThreadCutoff'],
      ['--multi-thread-chunk-size', 'MultiThreadChunkSize'],
      ['--low-level-retries', 'LowLevelRetries'],
    ] as const) {
      const index = args.indexOf(flag);
      if (index >= 0)
        Object.assign(options, {
          [key]: ['MultiThreadStreams', 'LowLevelRetries'].includes(key)
            ? Number(args[index + 1])
            : args[index + 1],
        });
    }
    const group = `launcher-${randomUUID()}`;
    this.record({
      event: 'transfer-options',
      group,
      command,
      https: true,
      bandwidthLimit: 'off',
      fileBandwidthLimit: 'off',
      tpsLimit: 0,
      streams: 4,
      cutoffBytes: 64 * 1024 * 1024,
      chunkBytes: 16 * 1024 * 1024,
      overrides: options,
    });
    const started = performance.now();
    let previous = { bytes: 0, time: started };
    let sampling: Promise<void> | undefined;
    const readStats = async () => {
      if (this.stopping) return;
      const stats = await request('core/stats', { group }, 5000);
      const now = performance.now();
      const sample = sampleTransfer(stats, previous, now, started);
      previous = { bytes: sample.bytes ?? 0, time: now };
      this.record({
        event: 'transfer-sample',
        group,
        bytes: sample.bytes,
        totalBytes: sample.totalBytes,
        speed: sample.speed,
        averageSpeed: sample.averageSpeed,
        rcloneSpeed: stats.speed,
        elapsedSeconds: (now - started) / 1000,
        errors: stats.errors,
        retries: stats.retryError,
      });
      progress?.(sample);
    };
    const poll = () => {
      if (!sampling)
        sampling = readStats().finally(() => {
          sampling = undefined;
        });
      return sampling;
    };
    const timer = setInterval(() => {
      void poll().catch(() => {});
    }, 1000);
    try {
      if (command === 'copy')
        await request(
          'sync/copy',
          { srcFs: from, dstFs: to, _config: options, _group: group },
          24 * 60 * 60 * 1000,
        );
      else {
        const source = splitFileLocation(from),
          destination = splitFileLocation(to);
        await request(
          command === 'moveto' ? 'operations/movefile' : 'operations/copyfile',
          {
            srcFs: source.fs,
            srcRemote: source.remote,
            dstFs: destination.fs,
            dstRemote: destination.remote,
            _config: options,
            _group: group,
          },
          24 * 60 * 60 * 1000,
        );
      }
      clearInterval(timer);
      await poll().catch(() => {});
      return '';
    } finally {
      clearInterval(timer);
      await sampling?.catch(() => {});
      if (!this.stopping) await request('core/stats-delete', { group }, 5000).catch(() => {});
    }
  }
}
