// Deletes only generated fixtures; local alias cloud never touches a real account.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve('test-results', `delete-ui-${Date.now()}`);
  const local = path.join(root, 'games'),
    cloud = path.join(root, 'remote');
  await fs.mkdir(local, { recursive: true });
  await fs.mkdir(path.join(cloud, 'PS2Cloud', 'Games'), { recursive: true });
  for (const name of ['Only Local.iso', 'Backed Up.bin'])
    await fs.writeFile(path.join(local, name), 'test image, not a game');
  await fs.writeFile(path.join(cloud, 'PS2Cloud', 'Games', 'Backed Up.bin'), 'test image, not a game');
  await fs.writeFile(path.join(cloud, 'PS2Cloud', 'Games', 'Cloud Only.chd'), 'cloud fixture');
  await fs.writeFile(path.join(local, 'Busy.iso'), Buffer.alloc(64 * 1024 * 1024));
  const desktop = await electron.launch({
    args: ['.'],
    env: { ...process.env, PS2_LAUNCHER_SMOKE: '1', VITE_DEV_SERVER_URL: '', RCLONE_BWLIMIT: '1M' },
  });
  try {
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Game library' })).toBeVisible();
    const snapshot = await page.evaluate(() => window.launcher.snapshot());
    if (!snapshot.settings.rcloneConfig.startsWith(path.resolve('test-results')))
      throw new Error('Isolated profile required');
    await fs.mkdir(path.dirname(snapshot.settings.rcloneConfig), { recursive: true });
    await fs.writeFile(snapshot.settings.rcloneConfig, `[fixture]\ntype = alias\nremote = ${cloud}\n`);
    await page.evaluate(
      async ({ local, root }) => {
        const snapshot = await window.launcher.snapshot();
        await window.launcher.saveSettings({
          ...snapshot.settings,
          remote: 'fixture',
          autoSyncSaves: false,
          gameDirectories: [local],
          downloadDirectory: root + '/downloads',
        });
      },
      { local, root },
    );
    await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
    await expect(page.locator('.game-card')).toHaveCount(4);
    await expect(page.locator('.game-card').last()).toHaveCSS('opacity', '1');
    const card = (title) =>
      page.locator('.game-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const openDelete = async (title) => {
      await card(title)
        .getByRole('button', { name: `Меню игры ${title}`, exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Удалить игру', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    };
    const titleBox = await card('Only Local').getByRole('heading').boundingBox();
    const toggleBox = await card('Only Local')
      .getByRole('button', { name: 'Меню игры Only Local', exact: true })
      .boundingBox();
    expect(Math.abs(titleBox.y + titleBox.height / 2 - toggleBox.y - toggleBox.height / 2)).toBeLessThan(2);
    await card('Only Local')
      .getByRole('button', { name: 'Меню игры Only Local', exact: true })
      .press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Удалить игру', exact: true })).toBeFocused();
    await page.screenshot({ path: path.join(root, 'game-menu.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(
      card('Only Local').getByRole('button', { name: 'Меню игры Only Local', exact: true }),
    ).toBeFocused();
    await openDelete('Only Local');
    await expect(page.getByRole('dialog')).toContainText(
      'Эта игра не сохранена в вашем облаке! Вы её потеряете навсегда!',
    );
    await page.screenshot({ path: path.join(root, 'delete-local-warning.png'), fullPage: true });
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    expect(await fs.readFile(path.join(local, 'Only Local.iso'), 'utf8')).toContain('test image');
    await openDelete('Only Local');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await openDelete('Only Local');
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(card('Only Local')).toHaveCount(0);
    await expect(fs.access(path.join(local, 'Only Local.iso'))).rejects.toThrow();
    await openDelete('Backed Up');
    await expect(page.getByRole('dialog')).toContainText(
      'Игра находится в вашем облаке, так что вы в любой момент сможете её оттуда скачать.',
    );
    await page.screenshot({ path: path.join(root, 'delete-backed-up.png'), fullPage: true });
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(card('Backed Up').getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
    await expect(fs.access(path.join(local, 'Backed Up.bin'))).rejects.toThrow();
    expect(await fs.readFile(path.join(cloud, 'PS2Cloud', 'Games', 'Backed Up.bin'), 'utf8')).toContain(
      'test image',
    );
    await card('Cloud Only').getByRole('button', { name: 'Меню игры Cloud Only', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Удалить игру', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    const guarded = await page.evaluate(async () => {
      const game = (await window.launcher.library()).games.find((game) => game.title === 'Busy');
      const deletion = await window.launcher.prepareDeleteGame(game.id);
      const plan = await window.launcher.planSync({ kind: 'Games', direction: 'upload', gameId: game.id });
      const transfer = await window.launcher.enqueueSync(plan.id, true);
      const errors = [];
      for (const call of [
        () => window.launcher.prepareDeleteGame(game.id),
        () => window.launcher.deleteGame(deletion.token, true),
      ]) {
        try {
          await call();
        } catch (error) {
          errors.push(error.message);
        }
      }
      await window.launcher.cancelTransfer(transfer.id);
      return errors;
    });
    expect(guarded).toHaveLength(2);
    expect(guarded.every((error) => error.includes('Cancel this game transfer'))).toBe(true);
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.launcher.transfers())).some((t) =>
          ['running', 'cancelling', 'queued'].includes(t.state),
        ),
      )
      .toBe(false);
    expect(await fs.stat(path.join(local, 'Busy.iso')).then((stat) => stat.size)).toBe(64 * 1024 * 1024);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 760));
    await openDelete('Busy');
    await page.screenshot({ path: path.join(root, 'delete-responsive.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    expect(errors).toEqual([]);
    console.log(
      'Game deletion UI passed: aligned menu, keyboard/Escape, cancel, both warnings, real confirmed local deletion, cloud preserved, cloud-only disabled, queued/active transfer protection and responsive modal.',
    );
  } finally {
    await desktop.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
