// Read-only downloads of a selected remote object. Run after npm run build.
// --manifest points to an ignored JSON containing binary/config/remote/source.
// source is an optional local reference file for SHA-256 verification.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createReadStream } = require('node:fs');

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
function cliFlags(streams) {
  return [
    '--mega-use-https',
    '--bwlimit',
    'off',
    '--bwlimit-file',
    'off',
    '--tpslimit',
    '0',
    '--multi-thread-streams',
    String(streams),
    '--multi-thread-cutoff',
    '64Mi',
    '--multi-thread-chunk-size',
    '16Mi',
    '--ignore-times',
    '--retries',
    '1',
    '--low-level-retries',
    '1',
    '--use-json-log',
    '--stats',
    '1s',
    '--stats-log-level',
    'NOTICE',
    '--log-level',
    'DEBUG',
  ];
}
async function cli(data, destination, streams) {
  const { transferDiagnostic } = require('../dist-electron/electron/services/transfer-log');
  return new Promise((resolve, reject) => {
    const started = performance.now(),
      samples = [],
      diagnostics = [];
    const args = ['copyto', data.remote, destination, '--config', data.config, ...cliFlags(streams)];
    const child = spawn(data.binary, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 120_000);
    let pending = '';
    child.stderr.on('data', (chunk) => {
      pending += chunk.toString();
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        const diagnostic = transferDiagnostic(line);
        if (diagnostic) diagnostics.push(diagnostic);
        try {
          const s = JSON.parse(line).stats;
          if (s)
            samples.push({
              bytes: s.bytes,
              speed: s.speed,
              elapsedSeconds: (performance.now() - started) / 1000,
            });
        } catch {}
      }
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Benchmark process failed.'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        code,
        elapsedSeconds: (performance.now() - started) / 1000,
        samples,
        diagnostics,
      });
    });
  });
}
async function runCase(data, name, root) {
  const streams = name.endsWith('-single') ? 0 : 4;
  const destination = path.join(root, `${name}.dat`);
  let result;
  if (name.startsWith('electron-rc')) {
    const { SettingsStore } = require('../dist-electron/electron/services/settings');
    const { RcloneService } = require('../dist-electron/electron/services/rclone');
    const store = new SettingsStore(path.join(root, 'service'), root);
    await store.load();
    await store.save({
      ...store.value,
      cloudProvider: 'mega',
      remote: data.remote.split(':')[0],
      rcloneConfig: data.config,
    });
    const service = new RcloneService(store, () => {}, data.binary),
      samples = [];
    const timer = setTimeout(() => service.dispose(), 120_000);
    const started = performance.now();
    try {
      await service.call(['copyto', data.remote, destination, ...cliFlags(streams)], (p) =>
        samples.push({
          bytes: p.bytes,
          speed: p.speed,
          averageSpeed: p.averageSpeed,
          elapsedSeconds: (performance.now() - started) / 1000,
        }),
      );
      result = { success: true, elapsedSeconds: (performance.now() - started) / 1000, samples };
    } catch {
      result = { success: false, elapsedSeconds: (performance.now() - started) / 1000, samples };
    } finally {
      clearTimeout(timer);
      service.dispose();
      await service.transferLogDirectory();
    }
  } else result = await cli(data, destination, streams);
  const bytes = await fs
    .stat(destination)
    .then((s) => s.size)
    .catch(() => 0);
  if (result.success) {
    result.sha256 = await hash(destination);
    if (data.source) result.verified = result.sha256 === (await hash(data.source));
  }
  return {
    name,
    streams,
    https: true,
    bandwidthLimit: 'off',
    bytes,
    ...result,
    wallBytesPerSecond: result.success ? bytes / result.elapsedSeconds : undefined,
  };
}
async function main() {
  if (!process.argv.includes('--manifest'))
    throw new Error('Use --manifest <ignored JSON with binary, config, remote and optional source>.');
  const data = JSON.parse(await fs.readFile(argument('--manifest'), 'utf8'));
  const root = path.resolve(
    argument('--output') || path.join('test-results', `mega-benchmark-${Date.now()}`),
  );
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (process.argv.includes('--electron-child')) {
    const { app } = require('electron');
    await app.whenReady();
    try {
      const result = await runCase(data, argument('--case'), root);
      await fs.writeFile(path.join(root, `${result.name}.json`), JSON.stringify(result, null, 2));
    } finally {
      app.quit();
    }
    return;
  }
  const results = [];
  const available = [
    'direct-single',
    'direct-multi',
    'electron-cli-multi',
    'electron-rc-single',
    'electron-rc-multi',
  ];
  const cases = argument('--cases')?.split(',') ?? available;
  if (cases.some((name) => !available.includes(name))) throw new Error('Unknown benchmark case.');
  for (const name of cases) {
    console.log(`Benchmark ${name} (120-second maximum)…`);
    let result;
    if (name.startsWith('direct-')) result = await runCase(data, name, root);
    else {
      const electron = require('electron');
      await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(
          electron,
          [
            __filename,
            '--electron-child',
            '--case',
            name,
            '--manifest',
            path.resolve(argument('--manifest')),
            '--output',
            root,
          ],
          {
            windowsHide: true,
            stdio: 'ignore',
            env,
          },
        );
        child.once('error', () => reject(new Error('Electron benchmark could not start.')));
        child.once('close', (code) =>
          code === 0 ? resolve() : reject(new Error('Electron benchmark failed.')),
        );
      });
      result = JSON.parse(await fs.readFile(path.join(root, `${name}.json`), 'utf8'));
    }
    results.push(result);
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(results, null, 2));
    console.log(
      JSON.stringify({
        name,
        success: result.success,
        verified: result.verified,
        seconds: result.elapsedSeconds,
        MiBPerSecond: result.wallBytesPerSecond / 1024 / 1024,
      }),
    );
  }
  console.log(`Report: ${path.join(root, 'report.json')}`);
}
main().catch(() => {
  console.error('Benchmark failed. Check manifest and cloud access; credentials are never printed.');
  process.exitCode = 1;
});
