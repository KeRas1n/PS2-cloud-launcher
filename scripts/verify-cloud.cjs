// Real bundled binary + two-device sync, isolated local alias backend; no Dropbox account needed.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SettingsStore } = require('../dist-electron/electron/services/settings');
const { RcloneService } = require('../dist-electron/electron/services/rclone');
const { AutoSyncService } = require('../dist-electron/electron/services/auto-sync');
const { walk } = require('../dist-electron/electron/services/files');

(async () => {
  const root = path.resolve('test-results', `cloud-${Date.now()}`);
  const binary = path.resolve(
    'tools',
    'bundled-rclone',
    process.platform,
    process.platform === 'win32' ? 'rclone.exe' : 'rclone',
  );
  const cloud = path.join(root, 'remote');
  await fs.mkdir(cloud, { recursive: true });
  let conflicts = 0;
  const devices = [];
  try {
    for (const name of ['device-a', 'device-b']) {
      const store = new SettingsStore(path.join(root, name, 'user'), path.join(root, name));
      await store.load();
      // Deliberately unusable external path: only the bundled executable can pass.
      await store.save({ ...store.value, rclonePath: path.join(root, 'missing-rclone'), remote: 'fixture' });
      const rclone = new RcloneService(store, () => {}, binary);
      await fs.mkdir(path.dirname(store.value.rcloneConfig), { recursive: true });
      await rclone.call(['config', 'create', 'fixture', 'alias', 'remote', cloud, '--no-output']);
      assert.equal((await rclone.status()).connected, true);
      const sync = new AutoSyncService(
        store,
        rclone,
        () => {},
        async () => {
          conflicts++;
          return 'download';
        },
        () => false,
      );
      await fs.mkdir(path.join(store.value.memcardsDirectory, 'nested'), { recursive: true });
      devices.push({
        store,
        rclone,
        sync,
        card: path.join(store.value.memcardsDirectory, 'nested', 'card.ps2'),
      });
    }
    const [a, b] = devices;
    await fs.writeFile(a.card, 'original');
    await a.sync.synchronize();
    await b.sync.synchronize();
    assert.equal(await fs.readFile(b.card, 'utf8'), 'original');
    await fs.writeFile(a.card, 'A played');
    await a.sync.synchronize();
    await b.sync.synchronize();
    assert.equal(await fs.readFile(b.card, 'utf8'), 'A played');
    await fs.writeFile(a.card, 'A second');
    await fs.writeFile(b.card, 'B played');
    await a.sync.synchronize();
    await b.sync.synchronize();
    assert.equal(conflicts, 1);
    assert.equal(await fs.readFile(b.card, 'utf8'), 'A second');
    const backups = await walk(path.join(b.store.userData, 'backups'));
    const contents = await Promise.all(backups.map((f) => fs.readFile(f.absolute, 'utf8')));
    assert.ok(contents.includes('B played'), 'Losing conflict version must survive in backups');
    await fs.unlink(b.card);
    await b.sync.synchronize();
    assert.equal(await fs.readFile(b.card, 'utf8'), 'A second');
    console.log('CLI cloud and two-device merge passed. Checking MEGA API transport and provider switching…');
    const mega = path.join(root, 'mega-remote');
    await fs.mkdir(mega, { recursive: true });
    for (const device of devices) {
      // Alias isolates transport tests from real accounts while exercising MEGA's persistent RC path.
      await device.rclone.call(['config', 'create', 'ps2-mega', 'alias', 'remote', mega, '--no-output']);
      await device.store.selectCloudProvider('mega');
      device.rclone.dispose();
      assert.equal((await device.rclone.status()).connected, true);
    }
    await a.sync.synchronize();
    await b.sync.synchronize();
    await fs.writeFile(a.card, 'MEGA A edit');
    await a.sync.synchronize();
    await fs.writeFile(b.card, 'MEGA B edit');
    await b.sync.synchronize();
    assert.equal(await fs.readFile(b.card, 'utf8'), 'MEGA A edit');
    assert.equal(conflicts, 2);
    const megaBackups = await walk(path.join(mega, 'PS2Cloud', 'Backups'));
    assert.ok(
      megaBackups.some((file) => /^[^/]+\/Memcards\/nested\/card\.ps2$/.test(file.path)),
      'RC backups must preserve relative paths without duplicating directories',
    );
    const localBackups = await walk(path.join(b.store.userData, 'backups'));
    assert.ok(
      (await Promise.all(localBackups.map((f) => fs.readFile(f.absolute, 'utf8')))).includes('MEGA B edit'),
    );
    // Selecting a provider alone must not transfer local files or erase either saved account.
    for (const device of devices) {
      await device.store.selectCloudProvider('dropbox');
      device.rclone.dispose();
      assert.equal(device.store.value.remote, 'fixture');
      assert.equal((await device.rclone.status()).connected, true);
      assert.deepEqual((await device.rclone.call(['listremotes'])).trim().split(/\r?\n/).sort(), [
        'fixture:',
        'ps2-mega:',
      ]);
      await device.store.selectCloudProvider('mega');
      assert.equal(device.store.value.remote, 'ps2-mega');
    }
    assert.equal(
      await fs.readFile(path.join(cloud, 'PS2Cloud', 'Memcards', 'nested', 'card.ps2'), 'utf8'),
      'A second',
    );
    console.log(
      'Cloud integration passed: bundled executable, CLI + persistent API transports, two devices, conflicts, backups, deletion recovery, Dropbox/MEGA switching with both accounts retained.',
    );
  } finally {
    for (const device of devices) device.rclone.dispose();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
