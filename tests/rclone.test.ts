import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SettingsStore } from '../electron/services/settings';
import { RcloneService } from '../electron/services/rclone';
import * as commands from '../electron/services/process';
import { RcloneRemoteControl } from '../electron/services/rclone-rc';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir('test-results', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'rclone-'));
  roots.push(root);
  const store = new SettingsStore(path.join(root, 'user'), root);
  await store.load();
  return { root, store };
}

it('prefers the bundled component over PATH and old external settings', async () => {
  const { root, store } = await fixture();
  const bundled = path.join(root, 'bundled-rclone');
  await fs.writeFile(bundled, 'executable fixture');
  const run = vi.spyOn(commands, 'run').mockResolvedValue('rclone v1.75.2');
  const service = new RcloneService(store, () => {}, bundled);
  await service.call(['version']);
  expect(run.mock.calls[0][0]).toBe(bundled);
});

it('prepares the cloud component automatically during first connection', async () => {
  const { store } = await fixture();
  let available = false;
  const run = vi.spyOn(commands, 'run');
  const service = new RcloneService(store, () => {});
  const install = vi.spyOn(service, 'install').mockImplementation(async () => {
    available = true;
  });
  // First remote list must be empty so connect uses config create rather than reconnect.
  let configured = false;
  run.mockImplementation(async (_binary, args) => {
    if (!available) throw new Error('not installed');
    if (args[0] === 'version') return 'rclone v1.75.2';
    if (args[0] === 'listremotes') return configured ? `${store.value.remote}:\n` : '';
    if (args[0] === 'config') configured = true;
    return '';
  });
  // Windows does not chmod; Linux needs a synthetic config file like the real command creates.
  await fs.mkdir(path.dirname(store.value.rcloneConfig), { recursive: true });
  await fs.writeFile(store.value.rcloneConfig, '');
  expect((await service.connect()).connected).toBe(true);
  expect(install).toHaveBeenCalledTimes(1);
  expect(run.mock.calls.some(([, args]) => args[0] === 'config' && args[1] === 'create')).toBe(true);
});

it('keeps independent Dropbox and MEGA profiles through switching and restart', async () => {
  const { root, store } = await fixture();
  await store.save({ ...store.value, remote: 'existing-dropbox', cloudRoot: 'MyDropboxSaves' });
  await store.selectCloudProvider('mega');
  expect(store.value.remote).toBe('ps2-mega');
  expect(store.value.cloudRoot).toBe('PS2Cloud');
  await store.save({ ...store.value, cloudRoot: 'MegaSaves' });
  await store.selectCloudProvider('dropbox');
  expect(store.value.remote).toBe('existing-dropbox');
  expect(store.value.cloudRoot).toBe('MyDropboxSaves');
  const loaded = new SettingsStore(store.userData, root);
  await loaded.load();
  await loaded.selectCloudProvider('mega');
  expect(loaded.value.cloudRoot).toBe('MegaSaves');
  expect(loaded.value.cloudProvider).toBe('mega');
  await loaded.selectCloudProvider('dropbox');
  expect(loaded.value.remote).toBe('existing-dropbox');
});

it('migrates existing Dropbox settings without losing the configured account', async () => {
  const { store } = await fixture();
  const { cloudProvider: _, cloudProfiles: __, ...old } = store.value;
  await fs.mkdir(store.userData, { recursive: true });
  await fs.writeFile(
    path.join(store.userData, 'settings.json'),
    JSON.stringify({ ...old, remote: 'old-account' }),
  );
  await store.load();
  expect(store.value.cloudProvider).toBe('dropbox');
  await store.selectCloudProvider('mega');
  await store.selectCloudProvider('dropbox');
  expect(store.value.remote).toBe('old-account');
});

it('validates inactive profiles before they can become active', async () => {
  const { store } = await fixture();
  await expect(
    store.save({ ...store.value, cloudProfiles: { mega: { remote: '--config', cloudRoot: 'Saves' } } }),
  ).rejects.toThrow();
  await expect(
    store.save({ ...store.value, cloudProfiles: { mega: { remote: 'mega', cloudRoot: '../private' } } }),
  ).rejects.toThrow();
});

async function megaFixture() {
  const f = await fixture();
  await f.store.selectCloudProvider('mega');
  const run = vi.spyOn(commands, 'run').mockImplementation(async (_binary, args) => {
    if (args[0] === 'version') return 'rclone v1.75.2';
    if (args.includes('--json')) return '[]';
    return 'ps2-mega:\n';
  });
  const request = vi.spyOn(RcloneRemoteControl.prototype, 'request').mockResolvedValue({});
  const command = vi.spyOn(RcloneRemoteControl.prototype, 'command').mockResolvedValue('[]');
  const service = new RcloneService(f.store, () => {});
  return { ...f, run, request, command, service };
}

it('sends MEGA credentials privately over RC and keeps two-factor codes out of stored settings', async () => {
  const f = await megaFixture();
  await fs.mkdir(path.dirname(f.store.value.rcloneConfig), { recursive: true });
  await fs.writeFile(f.store.value.rcloneConfig, '[dropbox]\ntoken = old-token\n');
  expect(
    (
      await f.service.connect({
        email: 'test@example.com',
        password: 'SecretFixturePassword',
        code: '123456',
      })
    ).connected,
  ).toBe(true);
  const call = f.request.mock.calls.find((call) => call[3] === 'config/create')!;
  expect(call[2]).toBe('123456');
  expect(call[4]).toMatchObject({
    name: 'ps2-mega',
    type: 'mega',
    parameters: {
      user: 'test@example.com',
      pass: 'SecretFixturePassword',
      use_https: 'true',
    },
    opt: { obscure: true, noOutput: true },
  });
  expect(JSON.stringify(call[4])).not.toContain('123456');
  expect(JSON.stringify(f.run.mock.calls)).not.toContain('SecretFixturePassword');
  expect(JSON.stringify(f.store.value)).not.toContain('SecretFixturePassword');
  expect(JSON.stringify(f.store.value)).not.toContain('123456');
});

it('restores existing connections and hides secrets after failed MEGA authentication', async () => {
  const f = await megaFixture();
  const original = '[ps2-dropbox]\ntoken = preserved-token\n[ps2-mega]\npass = old-password\n';
  await fs.mkdir(path.dirname(f.store.value.rcloneConfig), { recursive: true });
  await fs.writeFile(f.store.value.rcloneConfig, original);
  f.request.mockImplementation(async () => {
    await fs.writeFile(f.store.value.rcloneConfig, 'bad-new-config');
    throw new Error('SecretFixturePassword');
  });
  await expect(
    f.service.connect({ email: 'test@example.com', password: 'SecretFixturePassword' }),
  ).rejects.toThrow('MEGA sign-in failed');
  expect(await fs.readFile(f.store.value.rcloneConfig, 'utf8')).toBe(original);
});

it('refuses to replace a Dropbox remote with MEGA credentials', async () => {
  const f = await megaFixture();
  f.run.mockImplementation(async (_binary, args) =>
    args.includes('--json') ? '[{"name":"ps2-mega","type":"dropbox"}]' : 'rclone v1.75.2',
  );
  await expect(
    f.service.connect({ email: 'test@example.com', password: 'SecretFixturePassword' }),
  ).rejects.toThrow('not MEGA');
  expect(f.request).not.toHaveBeenCalled();
});

it('clears previous MEGA session keys before connecting a different account', async () => {
  const f = await megaFixture();
  f.run.mockImplementation(async (_binary, args) =>
    args[0] === 'version'
      ? 'rclone v1.75.2'
      : args.includes('--json')
        ? '[{"name":"ps2-mega","type":"mega"}]'
        : 'ps2-mega:\n',
  );
  await fs.mkdir(path.dirname(f.store.value.rcloneConfig), { recursive: true });
  await fs.writeFile(f.store.value.rcloneConfig, '[ps2-mega]\nsession_id = previous-session\n');
  await f.service.connect({ email: 'new@example.com', password: 'NewFixturePassword' });
  expect(f.request.mock.calls.map((call) => call[3])).toEqual(['config/delete', 'config/create']);
});
