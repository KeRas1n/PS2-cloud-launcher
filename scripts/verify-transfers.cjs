const { MegaCloudStorage } = require('../dist-electron/electron/services/mega-cloud-storage');
// Real bundled Rclone, local aliases: staged commits, account snapshots and cancellation.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SettingsStore } = require('../dist-electron/electron/services/settings');
const { RcloneService } = require('../dist-electron/electron/services/rclone');
const { GameService } = require('../dist-electron/electron/services/games');
const { SyncService } = require('../dist-electron/electron/services/sync');
const { walk } = require('../dist-electron/electron/services/files');

(async () => {
  const root = path.resolve('test-results', `background-real-${Date.now()}`);
  const binary = path.resolve(
    'tools/bundled-rclone',
    process.platform,
    process.platform === 'win32' ? 'rclone.exe' : 'rclone',
  );
  const store = new SettingsStore(path.join(root, 'user'), root);
  const clients = [];
  let base;
  try {
    await store.load();
    base = new RcloneService(store, () => {}, binary);
    clients.push(base);
    for (const [remote, folder] of [['ps2-mega', 'mega']]) {
      await fs.mkdir(path.join(root, folder), { recursive: true });
      await base.call([
        'config',
        'create',
        remote,
        'alias',
        'remote',
        path.join(root, folder),
        '--no-output',
      ]);
    }
    const local = path.join(store.value.downloadDirectory, 'Fixture.iso');
    await fs.mkdir(path.dirname(local), { recursive: true });
    const emulator = { running: true, gamePath: path.join(root, 'Other.iso') };
    for (const provider of ['mega']) {
      base.dispose();
      await base.ensureFolders();
      const remoteFile = path.join(root, provider, 'PS2Cloud', 'Games', 'Fixture.iso');
      await fs.writeFile(local, 'new game bytes');
      await fs.writeFile(remoteFile, 'old cloud bytes');
      const games = new GameService(store, new MegaCloudStorage(base));
      games.games.set('fixture', {
        id: 'fixture',
        title: 'Fixture',
        name: 'Fixture.iso',
        state: 'In Cloud',
        size: 14,
        localPath: local,
        cloudPath: 'Fixture.iso',
      });
      const preview = new SyncService(store, new MegaCloudStorage(base), games, emulator, () => {});
      const plan = await preview.plan({ kind: 'Games', direction: 'upload', gameId: 'fixture' });
      const prepared = preview.detach(plan.id, true);
      const directory = path.join(root, `worker-${provider}`);
      const { client, store: scoped } = await new MegaCloudStorage(base).createTransferClient(
        structuredClone(store.value),
        directory,
      );
      clients.push(client);
      const scopedGames = new GameService(scoped, client);
      scopedGames.games = new Map(games.games);
      // Mutating the active account must not reroute the already accepted job.
      await store.save({ ...store.value, remote: 'other-account' });
      base.dispose();
      const worker = new SyncService(scoped, client, scopedGames, emulator, () => {}, true);
      worker.adopt(prepared);
      await worker.execute(plan.id, true);
      assert.equal(await fs.readFile(remoteFile, 'utf8'), 'new game bytes');
      assert.equal(
        await fs.readFile(
          path.join(root, provider, 'PS2Cloud', 'Backups', plan.id, 'Games', 'Fixture.iso'),
          'utf8',
        ),
        'old cloud bytes',
      );
      // Replaced local disc remains backed up. No partial file becomes a library game.
      await fs.writeFile(local, 'old local bytes');
      const download = await worker.plan({ kind: 'Games', direction: 'download', gameId: 'fixture' });
      await worker.execute(download.id, true);
      assert.equal(await fs.readFile(local, 'utf8'), 'new game bytes');
      assert.equal(
        await fs.readFile(path.join(download.backupLocation, 'Fixture.iso'), 'utf8'),
        'old local bytes',
      );
      // Cancel a real transfer after the process starts. Its target must stay untouched.
      const handle = await fs.open(local, 'w');
      await handle.truncate(128 * 1024 * 1024);
      await handle.close();
      const cancelPlan = await worker.plan({ kind: 'Games', direction: 'upload', gameId: 'fixture' });
      const controller = new AbortController();
      client.setCancellation(controller.signal);
      const cancelWorker = new SyncService(
        scoped,
        client,
        scopedGames,
        emulator,
        () => {},
        true,
        controller.signal,
      );
      cancelWorker.adopt(worker.detach(cancelPlan.id, true));
      // Cancel promptly; MEGA runtime forces bandwidth limits off.
      process.env.RCLONE_BWLIMIT = '1M';
      const copying = cancelWorker.execute(cancelPlan.id, true);
      const timer = setTimeout(() => controller.abort(), 30);
      await assert.rejects(copying);
      clearTimeout(timer);
      delete process.env.RCLONE_BWLIMIT;
      assert.equal(await fs.readFile(remoteFile, 'utf8'), 'new game bytes');
      assert.ok(!(await walk(path.dirname(remoteFile))).some((file) => file.path.endsWith('.partial')));
      await client.close();
      console.log(
        `${provider}: game transfers during gameplay, frozen account, upload/download backups and cancellation passed`,
      );
    }
  } finally {
    delete process.env.RCLONE_BWLIMIT;
    await Promise.all(clients.map((client) => client.close()));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
