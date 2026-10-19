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

it('migrates retired storage while preserving local paths and saved MEGA profile', async () => {
  const { store, root } = await fixture();
  for (const profile of [undefined, { remote: 'saved-mega', cloudRoot: 'MySaves' }]) {
    const saved = {
      ...store.value,
      cloudProvider: 'retired',
      remote: 'old-account',
      cloudProfiles: {
        retired: { remote: 'old-account', cloudRoot: 'OldSaves' },
        ...(profile ? { mega: profile } : {}),
      },
    };
    await fs.mkdir(store.userData, { recursive: true });
    await fs.writeFile(path.join(store.userData, 'settings.json'), JSON.stringify(saved));
    await store.load();
    expect(store.value.cloudProvider).toBe('mega');
    expect(store.value.remote).toBe(profile?.remote ?? 'ps2-mega');
    expect(store.value.cloudRoot).toBe(profile?.cloudRoot ?? 'PS2Cloud');
    expect(store.value.memcardsDirectory).toBe(saved.memcardsDirectory);
    expect(store.value.cloudProfiles).toEqual({});
    const loaded = new SettingsStore(store.userData, root);
    await loaded.load();
    expect(loaded.value).toEqual(store.value);
  }
});

it('rejects unsupported storage in new settings', async () => {
  const { store } = await fixture();
  await expect(store.save({ ...store.value, cloudProvider: 'retired' })).rejects.toThrow();
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
  await fs.writeFile(f.store.value.rcloneConfig, '[other]\ntoken = old-token\n');
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
  const original = '[ps2-mega]\npass = old-password\n';
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

it('refuses to replace an incompatible remote with MEGA credentials', async () => {
  const f = await megaFixture();
  f.run.mockImplementation(async (_binary, args) =>
    args.includes('--json') ? '[{"name":"ps2-mega","type":"s3"}]' : 'rclone v1.75.2',
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

it('prepares the component automatically before MEGA sign-in', async () => {
  const f = await megaFixture();
  const status = vi
    .spyOn(f.service, 'status')
    .mockResolvedValueOnce({ installed: false, connected: false, remotes: [] })
    .mockResolvedValue({ installed: true, connected: true, remotes: ['ps2-mega'] });
  const install = vi.spyOn(f.service, 'install').mockResolvedValue();
  await fs.mkdir(path.dirname(f.store.value.rcloneConfig), { recursive: true });
  await fs.writeFile(f.store.value.rcloneConfig, '');
  await f.service.connect({ email: 'test@example.com', password: 'FixturePassword' });
  expect(install).toHaveBeenCalledOnce();
  expect(status).toHaveBeenCalledTimes(2);
  expect(f.request.mock.calls.some((call) => call[3] === 'config/create')).toBe(true);
});

it('migrates preferences without a provider to the MEGA default', async () => {
  const { store } = await fixture();
  const { cloudProvider: _, cloudProfiles: __, ...old } = store.value;
  await fs.mkdir(store.userData, { recursive: true });
  await fs.writeFile(
    path.join(store.userData, 'settings.json'),
    JSON.stringify({ ...old, remote: 'old-account' }),
  );
  await store.load();
  expect(store.value.cloudProvider).toBe('mega');
  expect(store.value.remote).toBe('ps2-mega');
  expect(store.value.memcardsDirectory).toBe(old.memcardsDirectory);
});
