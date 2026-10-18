import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TransferLog, transferDiagnostic } from '../electron/services/transfer-log';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it('records useful diagnostic categories without credentials, raw errors or signed URLs', () => {
  const secret = 'SecretFixturePassword';
  const line = JSON.stringify({
    level: 'error',
    msg: `retry quota HTTP 509 password=${secret} https://mega.example/file?token=${secret}`,
  });
  const result = transferDiagnostic(line);
  expect(result).toMatchObject({ event: 'quota', level: 'error', httpStatus: 509, reason: 'quota' });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(transferDiagnostic(JSON.stringify({ level: 'debug', msg: `password=${secret}` }))).toBeUndefined();
  expect(
    transferDiagnostic(JSON.stringify({ level: 'debug', msg: 'multi-thread copy: using concurrency of 4' })),
  ).toMatchObject({ event: 'backend-multithread', streams: 4 });
});

it('writes ordered metrics and rotates bounded logs', async () => {
  await fs.mkdir('test-results', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results/log-test-'));
  roots.push(root);
  const log = new TransferLog(root);
  log.write({ event: 'transfer-start', id: 'a' });
  log.write({ event: 'transfer-sample', bytes: 65536, speed: 65536 });
  await log.flush();
  const file = path.join(log.directory, 'transfers.jsonl');
  expect(
    (await fs.readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).event),
  ).toEqual(['transfer-start', 'transfer-sample']);
  await fs.writeFile(file, 'x'.repeat(5 * 1024 * 1024));
  log.write({ event: 'transfer-finish', success: true });
  await log.flush();
  expect(JSON.parse((await fs.readFile(file, 'utf8')).trim()).success).toBe(true);
  expect((await fs.stat(file + '.1')).size).toBe(5 * 1024 * 1024);
});
