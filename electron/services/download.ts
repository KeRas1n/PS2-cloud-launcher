import { createWriteStream, promises as fs, constants } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { path7za } from '7zip-bin';
import type { Progress } from '../../shared/types';
import { run } from './process';

const allowed = [
  'github.com',
  'api.github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'downloads.rclone.org',
];
export async function trustedFetch(url: string, timeout = 60_000): Promise<Response> {
  for (let redirect = 0; redirect < 8; redirect++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !allowed.includes(parsed.hostname))
      throw new Error('Untrusted download host.');
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': 'PS2-Cloud-Launcher' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = new URL(response.headers.get('location')!, url).href;
      continue;
    }
    if (!response.ok)
      throw new Error(`Download failed: HTTP ${response.status}. GitHub rate limits may apply.`);
    return response;
  }
  throw new Error('Too many download redirects.');
}
export async function download(
  url: string,
  file: string,
  operation: string,
  emit: (p: Progress) => void,
  digest?: string | null,
) {
  const response = await trustedFetch(url, 30 * 60_000);
  if (!response.body) throw new Error('Download returned no data.');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const total = Number(response.headers.get('content-length')) || undefined;
  let bytes = 0,
    last = 0;
  const hash = createHash('sha256');
  const source = Readable.fromWeb(response.body as never);
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    hash.update(chunk);
    if (Date.now() - last > 200) {
      last = Date.now();
      emit({
        operation,
        message: 'Downloading official release',
        bytes,
        totalBytes: total,
        percent: total ? (bytes / total) * 100 : undefined,
      });
    }
  });
  try {
    await pipeline(source, createWriteStream(file, { flags: 'wx' }));
    const actual = hash.digest('hex');
    if (digest?.startsWith('sha256:') && actual !== digest.slice(7))
      throw new Error('Release checksum mismatch. Download discarded.');
  } catch (error) {
    await fs.rm(file, { force: true });
    throw error;
  }
}
export async function extract(archive: string, target: string) {
  let binary = path7za.replace('app.asar', 'app.asar.unpacked');
  let executableCopy: string | undefined;
  try {
    if (process.platform !== 'win32') {
      try {
        await fs.access(binary, constants.X_OK);
      } catch {
        // AppImages mount read-only. Never chmod a bundled tool in place.
        executableCopy = await fs.mkdtemp(path.join(os.tmpdir(), 'ps2-cloud-extract-'));
        const copy = path.join(executableCopy, '7za');
        await fs.copyFile(binary, copy);
        await fs.chmod(copy, 0o700);
        binary = copy;
      }
    }
    await fs.mkdir(target, { recursive: true });
    // Release archives are downloaded only from allowlisted official hosts.
    await run(binary, ['x', archive, `-o${target}`, '-y'], { timeout: 300_000 });
  } finally {
    if (executableCopy) await fs.rm(executableCopy, { recursive: true, force: true });
  }
}
