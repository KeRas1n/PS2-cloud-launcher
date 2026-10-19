const { MegaCloudStorage } = require('../dist-electron/electron/services/mega-cloud-storage');
// Real bundled binary + two-device sync, isolated local alias backend; no cloud account needed.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SettingsStore } = require('../dist-electron/electron/services/settings');
const { RcloneService } = require('../dist-electron/electron/services/rclone');
const { AutoSyncService } = require('../dist-electron/electron/services/auto-sync');
const { walk } = require('../dist-electron/electron/services/files');
const { BiosSyncService } = require('../dist-electron/electron/services/bios-sync');
const { TransferQueue } = require('../dist-electron/electron/services/transfer-queue');

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
        new MegaCloudStorage(rclone),
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
    console.log('Two-device merge passed. Checking another MEGA account…');
    const mega = path.join(root, 'mega-remote');
    await fs.mkdir(mega, { recursive: true });
    for (const device of devices) {
      // Alias isolates transport tests from real accounts while exercising MEGA's persistent RC path.
      await device.rclone.call(['config', 'create', 'ps2-mega', 'alias', 'remote', mega, '--no-output']);
      await device.store.save({ ...device.store.value, remote: 'ps2-mega' });
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
    assert.equal(
      await fs.readFile(path.join(cloud, 'PS2Cloud', 'Memcards', 'nested', 'card.ps2'), 'utf8'),
      'A second',
    );
    // Synthetic ROM metadata only; exercise real Rclone upload/download, no personal BIOS.
    const bios = Buffer.alloc(512 * 1024);
    for (const [index, name, length] of [
      [0, 'RESET', 0x100],
      [1, 'ROMDIR', 64],
      [2, 'ROMVER', 14],
    ]) {
      bios.write(name, 0x100 + index * 16, 'ascii');
      bios.writeUInt32LE(length, 0x100 + index * 16 + 12);
    }
    bios.write('0200EC20040614', 0x140, 'ascii');
    await fs.mkdir(a.store.value.biosDirectory, { recursive: true });
    await fs.writeFile(path.join(a.store.value.biosDirectory, 'console.bin'), bios);
    for (const [device, direction] of [
      [a, 'upload'],
      [b, 'download'],
    ]) {
      const queue = new TransferQueue(() => {});
      try {
        const service = new BiosSyncService(device.store, new MegaCloudStorage(device.rclone), queue);
        await service.enqueue(direction);
        const deadline = Date.now() + 60_000;
        while (queue.active && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(queue.list()[0].state, 'completed', JSON.stringify(queue.list()));
        assert.equal(queue.list()[0].bytes, bios.length);
      } finally {
        await queue.shutdown();
      }
    }
    assert.deepEqual(await fs.readFile(path.join(mega, 'PS2Cloud', 'BIOS', 'console.bin')), bios);
    assert.deepEqual(await fs.readFile(path.join(b.store.value.biosDirectory, 'console.bin')), bios);
    console.log(
      'Cloud integration passed: bundled executable, persistent API transport, two devices, conflicts, backups, deletion recovery, queued BIOS upload/download.',
    );
  } finally {
    for (const device of devices) device.rclone.dispose();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
