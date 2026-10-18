const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve('test-results');
  await fs.mkdir(root, { recursive: true });
  const desktop = await electron.launch({
    args: ['.'],
    env: { ...process.env, PS2_LAUNCHER_SMOKE: '1', VITE_DEV_SERVER_URL: '', RCLONE_BWLIMIT: '2M' },
  });
  try {
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Game library' })).toBeVisible();
    await expect(page.getByText('Checking emulator and cloud connection…')).toBeHidden({ timeout: 30000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    expect(await page.evaluate(() => typeof window.launcher.snapshot)).toBe('function');
    await page.screenshot({ path: path.join(root, 'games.png'), fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Emulator' }).click();
    await expect(page.getByRole('button', { name: /^(Install|Update) PCSX2$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open PCSX2', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prepare emulator', exact: true })).toBeVisible();
    const invalidBios = path.join(root, 'invalid-bios.bin');
    await fs.writeFile(invalidBios, 'Invalid BIOS fixture. No executable ROM data.');
    await desktop.evaluate(({ dialog }, file) => {
      globalThis.originalOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, invalidBios);
    await page.getByRole('button', { name: 'Import BIOS', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('not a valid PS2 BIOS');
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    await desktop.evaluate(({ dialog }) => {
      dialog.showOpenDialog = globalThis.originalOpenDialog;
    });
    await page.screenshot({ path: path.join(root, 'emulator.png'), fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Cloud', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cloud', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Install Rclone' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect Dropbox', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Sync saves now' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Upload Memory Cards' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Open transfer logs' })).toBeVisible();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('progress', {
        operation: 'sync',
        message: 'Speed display fixture',
        bytes: 65536,
        totalBytes: 131072,
        speed: 65536,
        averageSpeed: 32768,
      }),
    );
    await expect(page.getByRole('status')).toContainText('64.0 KiB/s');
    await expect(page.getByRole('status')).not.toContainText('avg');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('progress', {
        operation: 'sync',
        message: 'Speed display fixture',
        speed: 0,
      }),
    );
    await expect(page.getByRole('status')).toContainText('0 B/s');
    await page.getByRole('button', { name: 'Dismiss activity' }).click();
    await page.screenshot({ path: path.join(root, 'cloud.png'), fullPage: true });
    const provider = page.getByLabel('Cloud storage', { exact: false });
    await expect(provider.locator('option').first()).toHaveText('MEGA (Recomended)');
    await provider.selectOption('mega');
    await expect(page.getByRole('heading', { name: 'MEGA', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect MEGA', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Connect Dropbox', exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(root, 'cloud-mega.png'), fullPage: true });
    await page.getByLabel('MEGA email', { exact: true }).fill('fixture@example.com');
    await page.getByLabel('MEGA password', { exact: true }).fill('FixturePassword');
    await expect(page.getByRole('button', { name: 'Connect MEGA', exact: true })).toBeEnabled();
    await provider.selectOption('dropbox');
    await expect(page.getByRole('button', { name: 'Connect Dropbox', exact: true })).toBeEnabled();
    expect((await page.evaluate(() => window.launcher.snapshot())).settings.remote).toBe('ps2-dropbox');
    await provider.selectOption('mega');
    await expect(page.getByLabel('MEGA password', { exact: true })).toHaveValue('');
    expect((await page.evaluate(() => window.launcher.snapshot())).settings.remote).toBe('ps2-mega');
    await provider.selectOption('dropbox');
    await expect(page.getByRole('button', { name: 'Connect Dropbox', exact: true })).toBeEnabled();
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Games', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('Dropbox remote name', { exact: false })).toHaveCount(0);
    const downloadDirectory = path.join(root, `tab-downloads-${Date.now()}`);
    await page.getByRole('textbox', { name: /^Game download directory/ }).fill(downloadDirectory);
    await page.getByRole('tab', { name: 'Emulator', exact: true }).click();
    const fullscreen = page.getByLabel('Launch games in fullscreen', { exact: false });
    const initialFullscreen = await fullscreen.isChecked();
    await fullscreen.setChecked(!initialFullscreen);
    await page.getByRole('tab', { name: 'Cloud', exact: true }).click();
    await expect(page.getByLabel('Automatically sync saves before and after playing')).toBeChecked();
    await page.getByText('Advanced cloud settings', { exact: true }).click();
    const remote = page.getByLabel('Dropbox remote name', { exact: false });
    await remote.fill('test-dropbox');
    await page.getByRole('tab', { name: 'Games', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /^Game download directory/ })).toHaveValue(
      downloadDirectory,
    );
    await page.screenshot({ path: path.join(root, 'settings-games.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Games', exact: true }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Emulator', exact: true })).toBeFocused();
    await expect(fullscreen).toBeChecked({ checked: !initialFullscreen });
    await page.screenshot({ path: path.join(root, 'settings-emulator.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Emulator', exact: true }).press('End');
    await expect(page.getByRole('tab', { name: 'Cloud', exact: true })).toBeFocused();
    await page.getByText('Advanced cloud settings', { exact: true }).click();
    await expect(remote).toHaveValue('test-dropbox');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(1);
    // Screen remounts and background snapshot refreshes must retain all unsaved edits.
    await page.getByRole('navigation').getByRole('button', { name: 'Cloud', exact: true }).click();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check connection', exact: true })).toBeEnabled();
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Unsaved changes.', { exact: true })).toBeVisible();
    await page.getByText('Advanced cloud settings', { exact: true }).click();
    await expect(remote).toHaveValue('test-dropbox');
    await page.getByRole('tab', { name: 'Games', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /^Game download directory/ })).toHaveValue(
      downloadDirectory,
    );
    await page.getByRole('tab', { name: 'Emulator', exact: true }).click();
    await expect(fullscreen).toBeChecked({ checked: !initialFullscreen });
    await page.getByRole('tab', { name: 'Cloud', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Preferences saved', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await expect(page.getByText('Unsaved changes.', { exact: true })).toHaveCount(0);
    const savedSettings = (await page.evaluate(() => window.launcher.snapshot())).settings;
    expect(savedSettings.remote).toBe('test-dropbox');
    expect(savedSettings.downloadDirectory).toBe(downloadDirectory);
    expect(savedSettings.fullscreen).toBe(!initialFullscreen);
    await page.screenshot({ path: path.join(root, 'settings.png'), fullPage: true });
    const fixture = path.join(root, 'fixture-games');
    await fs.mkdir(fixture, { recursive: true });
    await fs.writeFile(path.join(fixture, 'Test Disc.iso'), 'Test fixture only, not a playable disc.');
    await page.evaluate(async (directory) => {
      const snapshot = await window.launcher.snapshot();
      await window.launcher.saveSettings({ ...snapshot.settings, gameDirectories: [directory] });
    }, fixture);
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /^Games/ })
      .click();
    await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Test Disc', exact: true })).toBeVisible({
      timeout: 30000,
    });
    await desktop.evaluate(({ dialog }, file) => {
      globalThis.originalOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.resolve('assets/icon.png'));
    await page
      .locator('.game-card')
      .filter({ has: page.getByRole('heading', { name: 'Test Disc', exact: true }) })
      .locator('.game-cover')
      .hover();
    await page.getByRole('button', { name: 'Import cover for Test Disc', exact: true }).click();
    await expect(page.getByAltText('Test Disc cover')).toBeVisible({ timeout: 30000 });
    await expect
      .poll(() => page.getByAltText('Test Disc cover').evaluate((image) => image.naturalWidth))
      .toBe(256);
    await desktop.evaluate(({ dialog }) => {
      dialog.showOpenDialog = globalThis.originalOpenDialog;
    });
    if (!(await page.evaluate(() => window.launcher.snapshot())).emulator.installed) {
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Install PCSX2');
      await page.getByRole('button', { name: 'Dismiss error' }).click();
    }
    await page.screenshot({ path: path.join(root, 'library-with-fixture.png'), fullPage: true });
    // Real background jobs through secure IPC and the bundled Rclone. Local alias only.
    const cloud = path.join(root, `transfer-remote-${Date.now()}`);
    await fs.mkdir(path.join(cloud, 'PS2Cloud', 'Games'), { recursive: true });
    for (const title of ['Queued A', 'Queued B', 'Queued C']) {
      await fs.writeFile(
        path.join(
          cloud,
          'PS2Cloud',
          'Games',
          `${title}.${title === 'Queued A' ? 'bin' : title === 'Queued C' ? 'gs.xz' : 'iso'}`,
        ),
        Buffer.alloc(128 * 1024 * 1024, 0x42),
      );
    }
    const settings = (await page.evaluate(() => window.launcher.snapshot())).settings;
    await fs.mkdir(path.dirname(settings.rcloneConfig), { recursive: true });
    await fs.writeFile(settings.rcloneConfig, `[test-dropbox]\ntype = alias\nremote = ${cloud}\n`);
    await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Queued A', exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page
        .locator('.game-card')
        .filter({ has: page.getByRole('heading', { name: 'Queued A', exact: true }) })
        .locator('.cover-format'),
    ).toHaveText('BIN');
    await expect(
      page
        .locator('.game-card')
        .filter({ has: page.getByRole('heading', { name: 'Queued C', exact: true }) })
        .locator('.cover-format'),
    ).toHaveText('GS.XZ');
    await page.getByRole('button', { name: 'Download manager', exact: true }).click();
    await expect(page.getByText('No transfers yet', { exact: true })).toBeVisible();
    const queued = await page.evaluate(async () => {
      const library = await window.launcher.library();
      const result = [];
      for (const title of ['Queued A', 'Queued B', 'Queued C']) {
        const game = library.games.find((game) => game.title === title);
        const plan = await window.launcher.planSync({
          kind: 'Games',
          direction: 'download',
          gameId: game.id,
        });
        result.push(await window.launcher.enqueueSync(plan.id, true));
      }
      return result;
    });
    await expect
      .poll(async () => (await page.evaluate(() => window.launcher.transfers())).map((t) => t.state))
      .toEqual(['running', 'running', 'queued']);
    await expect(page.getByRole('article', { name: 'download Queued C', exact: true })).toContainText(
      'Queued',
    );
    await expect
      .poll(async () => (await page.evaluate(() => window.launcher.transfers()))[0].speed)
      .toBeGreaterThan(0);
    await page.screenshot({ path: path.join(root, 'downloads.png'), fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Games', exact: true }).click();
    const installed = page
      .locator('.game-card')
      .filter({ has: page.getByRole('heading', { name: 'Test Disc', exact: true }) });
    await expect(installed.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    // Reaching the normal missing-emulator error proves transfers do not reject launch IPC.
    if (!(await page.evaluate(() => window.launcher.snapshot())).emulator.installed) {
      await installed.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Install PCSX2');
      await page.getByRole('button', { name: 'Dismiss error' }).click();
    }
    await page.getByRole('button', { name: 'Cancel transfer for Queued A', exact: true }).click();
    await page.getByRole('button', { name: 'Download manager', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.launcher.transfers())).find((t) => t.id === queued[0].id).state,
      )
      .toBe('cancelled');
    await expect(page.getByRole('article', { name: 'download Queued B', exact: true })).toContainText(
      /KiB\/s|MiB\/s/,
    );
    await page.getByRole('button', { name: 'Cancel download Queued C', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.launcher.transfers())).find((t) => t.id === queued[1].id).state,
        { timeout: 90000 },
      )
      .toBe('completed');
    const downloaded = await fs.readdir(settings.downloadDirectory);
    expect(downloaded).toContain('Queued B.iso');
    expect(downloaded).not.toContain('Queued A.bin');
    expect(downloaded.some((name) => name.endsWith('.partial'))).toBe(false);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 760));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(root, 'downloads-responsive.png'), fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Games', exact: true }).click();
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 760));
    await page.screenshot({ path: path.join(root, 'responsive.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Cloud', exact: true }).press('Home');
    await expect(page.getByRole('tab', { name: 'Games', exact: true })).toBeFocused();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(root, 'settings-responsive.png'), fullPage: true });
    expect(errors).toEqual([]);
    console.log(
      'Electron smoke passed: secure preload, settings draft persistence across navigation/refresh, cloud switching, real concurrent Rclone downloads/queue/cancellation, launch during transfers, current speed, download manager and responsive layout.',
    );
  } finally {
    await desktop.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
