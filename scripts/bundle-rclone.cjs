const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { download, extract, trustedFetch } = require('../dist-electron/electron/services/download');

module.exports = async function bundleRclone(context) {
  const platform = context.electronPlatformName;
  // electron-builder's Arch.x64 = 1. Fail rather than package an incompatible tool.
  if (!['win32', 'linux'].includes(platform) || context.arch !== 1)
    throw new Error('Bundled cloud component requires Windows/Linux x64.');
  const version = 'v1.75.2';
  const os = platform === 'win32' ? 'windows' : 'linux';
  const name = `rclone-${version}-${os}-amd64`;
  const root = path.resolve('tools', 'bundled-rclone', platform);
  const binary = platform === 'win32' ? 'rclone.exe' : 'rclone';
  await fs.mkdir(root, { recursive: true });
  const archive = path.join(root, `${name}.zip`);
  const sums = await (await trustedFetch(`https://downloads.rclone.org/${version}/SHA256SUMS`)).text();
  const checksum = sums
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(`${name}.zip`))
    ?.trim()
    .split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(checksum ?? '')) throw new Error('Official Rclone checksum missing.');
  // Always verify a fresh official archive, including on machines with cached builds.
  await fs.rm(archive, { force: true });
  await download(
    `https://downloads.rclone.org/${version}/${name}.zip`,
    archive,
    'rclone',
    () => {},
    `sha256:${checksum.toLowerCase()}`,
  );
  await extract(archive, root);
  const source = path.join(root, name);
  const executable = await fs.readFile(path.join(source, binary));
  const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
  const destination = path.join(root, binary);
  let same = false;
  try {
    same = digest(await fs.readFile(destination)) === digest(executable);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Do not rewrite an identical executable that a running development app may use.
  if (!same) await fs.writeFile(destination, executable);
  // Official binary ZIPs embed their license in README.txt rather than COPYING.
  const readme = await fs.readFile(path.join(source, 'README.txt'), 'utf8');
  const license = readme.match(/Copyright \(C\) 2019 by Nick Craig-Wood[^]*?DEALINGS IN\s+THE SOFTWARE\./);
  if (!license || !license[0].includes('Permission is hereby granted'))
    throw new Error('Rclone license missing from verified archive.');
  await fs.writeFile(path.join(root, 'COPYING'), license[0].replace(/^ {4}/gm, '') + '\n');
  await fs.writeFile(path.join(root, 'VERSION'), version + '\n');
  if (platform === 'linux') await fs.chmod(path.join(root, binary), 0o755);
  await fs.rm(archive, { force: true });
};
