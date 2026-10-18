const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve('test-results');
  await fs.mkdir(root, { recursive: true });
  const desktop = await electron.launch({
    args: ['.'],
    env: { ...process.env, PS2_LAUNCHER_SMOKE: '1', VITE_DEV_SERVER_URL: '' },
  });
  try {
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Game library' })).toBeVisible();
    await expect(page.getByText('Checking emulator and cloud connection…')).toBeHidden({ timeout: 30000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    expect(await page.evaluate(() => typeof window.launcher.snapshot)).toBe('function');
    await page.screenshot({ path: path.join(root, 'games.png'), fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Emulator' }).click();
    await expect(page.getByRole('button', { name: 'Install PCSX2' })).toBeVisible();
    await page.screenshot({ path: path.join(root, 'emulator.png'), fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Cloud', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cloud saves. More freedom.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload Memory Cards' })).toBeDisabled();
    await page.screenshot({ path: path.join(root, 'cloud.png'), fullPage: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Rclone & Dropbox', { exact: true })).toBeVisible();
    const remote = page.getByLabel('Dropbox remote name', { exact: false });
    await remote.fill('test-dropbox');
    await page.getByRole('button', { name: 'Save changes' }).first().click();
    await expect(page.getByText('Preferences saved', { exact: true })).toBeVisible({ timeout: 30000 });
    expect((await page.evaluate(() => window.launcher.snapshot())).settings.remote).toBe('test-dropbox');
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
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Install PCSX2');
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    await page.screenshot({ path: path.join(root, 'library-with-fixture.png'), fullPage: true });
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 760));
    await page.screenshot({ path: path.join(root, 'responsive.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log(
      'Electron smoke passed: secure preload, four pages, settings IPC, real filesystem scanning, launch error, responsive layout.',
    );
  } finally {
    await desktop.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
