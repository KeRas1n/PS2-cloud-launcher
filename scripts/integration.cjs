// Opt-in network integration. Downloads official binaries; touches only test-results/integration-*.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { SettingsStore } = require('../dist-electron/electron/services/settings');
const { PCSX2Service } = require('../dist-electron/electron/services/pcsx2');
const { RcloneService } = require('../dist-electron/electron/services/rclone');
const { GameService } = require('../dist-electron/electron/services/games');
const { SyncService } = require('../dist-electron/electron/services/sync');

(async () => {
  const root = path.resolve('test-results', `integration-${Date.now()}`);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  const emit = (event) => {
    if (event.percent === 100) console.log(event.message);
  };
  const rclone = new RcloneService(store, emit);
  await rclone.install();
  assert.match((await rclone.status()).version, /^rclone v/);
  const cloud = path.join(root, 'cloud-fixture');
  await fs.mkdir(cloud, { recursive: true });
  await rclone.call(['config', 'create', 'fixture', 'alias', 'remote', cloud, '--no-output']);
  await store.save({ ...store.value, remote: 'fixture' });
  await rclone.ensureFolders();
  const pcsx2 = new PCSX2Service(store, emit);
  const games = new GameService(store, rclone);
  const sync = new SyncService(store, rclone, games, pcsx2, emit);
  const local = store.value.memcardsDirectory;
  const remote = path.join(cloud, 'PS2Cloud', 'Memcards');
  await fs.mkdir(path.join(local, 'nested'), { recursive: true });
  await fs.mkdir(path.join(remote, 'nested'), { recursive: true });
  await fs.writeFile(path.join(local, 'nested', 'card.ps2'), 'NEW LOCAL MEMORY CARD');
  await fs.writeFile(path.join(remote, 'nested', 'card.ps2'), 'OLD CLOUD MEMORY CARD');
  await fs.writeFile(path.join(remote, 'cloud-only.ps2'), 'KEEP CLOUD DATA');
  const upload = await sync.plan({ kind: 'Memcards', direction: 'upload' });
  assert.equal(upload.files[0].replaces, true);
  await assert.rejects(sync.execute(upload.id, false), /Confirm/);
  await sync.execute(upload.id, true);
  assert.equal(await fs.readFile(path.join(remote, 'nested', 'card.ps2'), 'utf8'), 'NEW LOCAL MEMORY CARD');
  assert.equal(
    await fs.readFile(
      path.join(cloud, 'PS2Cloud', 'Backups', upload.id, 'Memcards', 'nested', 'card.ps2'),
      'utf8',
    ),
    'OLD CLOUD MEMORY CARD',
  );
  assert.equal(await fs.readFile(path.join(remote, 'cloud-only.ps2'), 'utf8'), 'KEEP CLOUD DATA');
  await fs.writeFile(path.join(remote, 'nested', 'card.ps2'), 'NEW CLOUD MEMORY CARD');
  await fs.writeFile(path.join(local, 'local-only.ps2'), 'KEEP LOCAL DATA');
  const download = await sync.plan({ kind: 'Memcards', direction: 'download' });
  await sync.execute(download.id, true);
  assert.equal(await fs.readFile(path.join(local, 'nested', 'card.ps2'), 'utf8'), 'NEW CLOUD MEMORY CARD');
  assert.equal(
    await fs.readFile(path.join(download.backupLocation, 'nested', 'card.ps2'), 'utf8'),
    'NEW LOCAL MEMORY CARD',
  );
  assert.equal(await fs.readFile(path.join(local, 'local-only.ps2'), 'utf8'), 'KEEP LOCAL DATA');
  // Real Rclone game transfers, using harmless text fixtures rather than distributed games.
  const discRoot = path.join(root, 'discs');
  await fs.mkdir(discRoot);
  await fs.writeFile(path.join(discRoot, 'Fixture.iso'), 'NOT A PLAYABLE GAME');
  await store.save({ ...store.value, gameDirectories: [discRoot] });
  let library = await games.scan();
  let game = library.games.find((g) => g.name === 'Fixture.iso');
  assert.equal(game.state, 'Local Only');
  const gameUpload = await sync.plan({ kind: 'Games', direction: 'upload', gameId: game.id });
  await sync.execute(gameUpload.id, true);
  library = await games.scan();
  game = library.games.find((g) => g.name === 'Fixture.iso');
  assert.equal(game.state, 'In Cloud');
  await fs.rename(path.join(discRoot, 'Fixture.iso'), path.join(discRoot, 'Fixture.test-data'));
  library = await games.scan();
  game = library.games.find((g) => g.name === 'Fixture.iso');
  assert.equal(game.state, 'Cloud Only');
  const gameDownload = await sync.plan({ kind: 'Games', direction: 'download', gameId: game.id });
  await sync.execute(gameDownload.id, true);
  library = await games.scan();
  assert.equal(library.games.find((g) => g.name === 'Fixture.iso').state, 'In Cloud');
  assert.equal(
    await fs.readFile(path.join(store.value.downloadDirectory, 'Fixture.iso'), 'utf8'),
    'NOT A PLAYABLE GAME',
  );
  console.log(
    'Real Rclone integration passed: both directions, nested backup contents, no deletion, all three game states.',
  );
  await fs.mkdir(store.value.biosDirectory, { recursive: true });
  await fs.writeFile(path.join(store.value.biosDirectory, 'preservation.test'), 'USER BIOS DATA');
  await fs.mkdir(path.join(store.value.dataDirectory, 'inis'), { recursive: true });
  await fs.writeFile(path.join(store.value.dataDirectory, 'inis', 'PCSX2.ini'), '[UI]\nTheme = dark');
  const installed = await pcsx2.install();
  assert.equal(installed.installed, true);
  assert.equal(installed.managed, true);
  assert.equal(
    await fs.readFile(path.join(store.value.biosDirectory, 'preservation.test'), 'utf8'),
    'USER BIOS DATA',
  );
  assert.equal(
    await fs.readFile(path.join(store.value.dataDirectory, 'inis', 'PCSX2.ini'), 'utf8'),
    '[UI]\nTheme = dark',
  );
  assert.equal(await fs.readFile(path.join(local, 'nested', 'card.ps2'), 'utf8'), 'NEW CLOUD MEMORY CARD');
  console.log(
    `Official PCSX2 ${installed.version} installation passed; BIOS, INI and memory card preserved.`,
  );
  const updated = await pcsx2.install();
  assert.notEqual(updated.path, installed.path);
  assert.equal(
    await fs.readFile(path.join(store.value.biosDirectory, 'preservation.test'), 'utf8'),
    'USER BIOS DATA',
  );
  assert.equal(
    await fs.readFile(path.join(store.value.dataDirectory, 'inis', 'PCSX2.ini'), 'utf8'),
    '[UI]\nTheme = dark',
  );
  assert.equal(await fs.readFile(path.join(local, 'nested', 'card.ps2'), 'utf8'), 'NEW CLOUD MEMORY CARD');
  console.log('PCSX2 update passed; previous executable retained and persistent data preserved.');
  console.log(`Artifacts: ${root}`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
