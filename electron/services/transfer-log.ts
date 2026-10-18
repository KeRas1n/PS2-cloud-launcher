import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface TransferEvent {
  event: string;
  [key: string]: unknown;
}
export class TransferLog {
  private pending: Promise<void> = Promise.resolve();
  private failure?: Error;
  readonly directory: string;
  constructor(userData: string) {
    this.directory = path.join(userData, 'logs');
  }
  write(event: TransferEvent) {
    const line = JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n';
    this.pending = this.pending
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = path.join(this.directory, 'transfers.jsonl');
        const size = await fs
          .stat(file)
          .then((s) => s.size)
          .catch(() => 0);
        if (size + Buffer.byteLength(line) > 5 * 1024 * 1024) {
          await fs.rm(file + '.1', { force: true });
          await fs.rename(file, file + '.1');
        }
        await fs.appendFile(file, line, { mode: 0o600 });
      })
      .catch((error) => {
        this.failure = error;
      });
  }
  async flush() {
    await this.pending;
    if (this.failure) throw this.failure;
  }
}

// Never record raw backend output: it may contain passwords, session keys or signed URLs.
export function transferDiagnostic(line: string): TransferEvent | undefined {
  let data: { msg?: string; level?: string };
  try {
    data = JSON.parse(line);
  } catch {
    return;
  }
  const message = data.msg ?? '';
  const version = /Version "(v\d+\.\d+\.\d+)"/.exec(message)?.[1];
  if (version) return { event: 'backend-version', version };
  if (/multi.thread copy/i.test(message))
    return {
      event: 'backend-multithread',
      level: data.level,
      streams:
        Number(/concurrency of\s+(\d+)|with\s+(\d+)\s+streams/i.exec(message)?.slice(1).find(Boolean)) ||
        undefined,
      phase: /finish|done|complete/i.test(message)
        ? 'complete'
        : /start|using/i.test(message)
          ? 'start'
          : 'progress',
    };
  const kind = /quota|over.?quota/i.test(message)
    ? 'quota'
    : /pacer.*reducing sleep/i.test(message)
      ? 'pacer-recovery'
      : /retry|retrying|pacer.*increasing|rate.?limit|throttl/i.test(message)
        ? 'retry-or-throttle'
        : data.level === 'error'
          ? 'backend-error'
          : undefined;
  if (kind)
    return {
      event: kind,
      level: data.level,
      httpStatus: Number(/(?:HTTP|status(?: code)?)\D{0,4}(\d{3})/i.exec(message)?.[1]) || undefined,
      reason: /quota/i.test(message)
        ? 'quota'
        : /rate.?limit|throttl/i.test(message)
          ? 'rate-limit'
          : /timeout|timed out/i.test(message)
            ? 'timeout'
            : /reset/i.test(message)
              ? 'connection-reset'
              : /EOF/i.test(message)
                ? 'unexpected-eof'
                : /TLS|SSL/i.test(message)
                  ? 'tls'
                  : undefined,
      attempt: Number(/retry\s+(\d+)\//i.exec(message)?.[1]) || undefined,
    };
}
