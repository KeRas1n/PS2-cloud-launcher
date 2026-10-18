// Reset only an isolated smoke profile and generated fixtures. No personal accounts/files.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve('test-results', `reset-ui-${Date.now()}`);
  const cloud = path.join(root, 'cloud');
  await fs.mkdir(path.join(cloud, 'PS2Cloud', 'Games'), { recursive: true });
  await fs.writeFile(
    path.join(cloud, 'PS2Cloud', 'Games', 'Cloud Fixture.iso'),
    Buffer.alloc(8 * 1024 * 1024),
  );
  const desktop = await electron.launch({
    args: ['.'],
    env: { ...process.env, PS2_LAUNCHER_SMOKE: '1', VITE_DEV_SERVER_URL: '', RCLONE_BWLIMIT: '1M' },
  });
  try {
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByText('Checking emulator and cloud connection…')).toBeHidden();
    const userData = await desktop.evaluate(({ app }) => app.getPath('userData'));
    const before = await page.evaluate(async (root) => {
      const { settings } = await window.launcher.snapshot();
      return window.launcher.saveSettings({
        ...settings,
        remote: 'fixture',
        fullscreen: false,
        autoSyncSaves: false,
        gameDirectories: [root + '/games'],
      });
    }, root);
    const kept = [
      path.join(root, 'games', 'Local Fixture.iso'),
      path.join(before.downloadDirectory, 'Downloaded Fixture.bin'),
      path.join(before.emulatorRoot, 'versions', 'keep-pcsx2.exe'),
      path.join(before.dataDirectory, 'PCSX2', 'inis', 'PCSX2.ini'),
      path.join(before.biosDirectory, 'keep-bios.bin'),
      path.join(before.memcardsDirectory, 'keep-card.ps2'),
      path.join(before.saveStatesDirectory, 'keep-state.p2s'),
      path.join(userData, 'backups', 'keep-backup.ps2'),
    ];
    for (const file of kept) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `preserved fixture: ${file}`);
    }
    const originals = await Promise.all(kept.map((file) => fs.readFile(file)));
    await fs.mkdir(path.dirname(before.rcloneConfig), { recursive: true });
    await fs.writeFile(before.rcloneConfig, `[fixture]\ntype = alias\nremote = ${cloud}\n`);
    await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Local Fixture', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cloud Fixture', exact: true })).toBeVisible();

    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Reset data', exact: true }).click();
    const resetButton = page.getByRole('button', { name: 'Delete launcher data', exact: true });
    await expect(resetButton).toBeEnabled();
    await resetButton.click();
    await expect(page.getByRole('dialog')).toContainText('Games, BIOS, saves, backups and PCSX2');
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(resetButton).toBeFocused();
    await fs.access(before.rcloneConfig);

    // The backend must reject unconfirmed calls, even if the UI is bypassed.
    expect(
      await page.evaluate(async () => {
        try {
          await window.launcher.resetLauncher(false);
          return '';
        } catch (error) {
          return error.message;
        }
      }),
    ).not.toBe('');

    // Active game downloads disable reset in the UI and block a direct IPC request.
    const transferId = await page.evaluate(async () => {
      const game = (await window.launcher.library()).games.find((game) => game.title === 'Cloud Fixture');
      const plan = await window.launcher.planSync({ kind: 'Games', direction: 'download', gameId: game.id });
      return (await window.launcher.enqueueSync(plan.id, true)).id;
    });
    await expect(resetButton).toBeDisabled();
    expect(
      await page.evaluate(async () => {
        try {
          await window.launcher.resetLauncher(true);
          return '';
        } catch (error) {
          return error.message;
        }
      }),
    ).toContain('transfers');
    await fs.access(before.rcloneConfig);
    await page.evaluate((id) => window.launcher.cancelTransfer(id), transferId);
    await expect(resetButton).toBeEnabled();
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.launcher.transfers())).some((item) =>
          ['running', 'queued', 'cancelling'].includes(item.state),
        ),
      )
      .toBe(false);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('progress', { emulatorRunning: true }),
    );
    await expect(resetButton).toBeDisabled();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('progress', { emulatorRunning: false }),
    );
    await expect(resetButton).toBeEnabled();

    const disposable = [
      'covers/fixture.img',
      'profiles/fixture.ini',
      'auto-sync/fixture.json',
      'transfer-staging/stale/rclone.conf',
      'tools/fixture.txt',
    ];
    for (const file of disposable) {
      const target = path.join(userData, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'launcher reset fixture');
    }
    await page.evaluate(() => localStorage.setItem('reset-fixture', 'remove'));
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 760));
    await resetButton.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(root, 'reset-confirmation.png'), fullPage: true });
    await page.getByRole('button', { name: 'Delete data and reload', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Game library' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Checking emulator and cloud connection…')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Local Fixture', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Downloaded Fixture', exact: true })).toBeVisible();
    for (const file of [...disposable, 'credentials/rclone.conf'])
      await expect(fs.access(path.join(userData, file))).rejects.toThrow();
    for (const [index, file] of kept.entries()) expect(await fs.readFile(file)).toEqual(originals[index]);
    const after = (await page.evaluate(() => window.launcher.snapshot())).settings;
    for (const key of [
      'gameDirectories',
      'downloadDirectory',
      'emulatorRoot',
      'pcsx2Path',
      'dataDirectory',
      'biosDirectory',
      'memcardsDirectory',
      'saveStatesDirectory',
    ])
      expect(after[key]).toEqual(before[key]);
    expect(after.remote).toBe('ps2-dropbox');
    expect(after.fullscreen).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('reset-fixture'))).toBeNull();
    expect(await page.evaluate(() => window.launcher.transfers())).toEqual([]);
    expect((await fs.stat(path.join(cloud, 'PS2Cloud', 'Games', 'Cloud Fixture.iso'))).size).toBe(
      8 * 1024 * 1024,
    );
    await page.screenshot({ path: path.join(root, 'after-reset.png'), fullPage: true });
    expect(errors).toEqual([]);
    console.log(
      'Launcher reset UI passed: confirmation/Escape, transfer and emulator guards, local account/cache removal, renderer reload, empty transfer history, games/BIOS/saves/PCSX2/backups and cloud files preserved.',
    );
  } finally {
    await desktop.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
