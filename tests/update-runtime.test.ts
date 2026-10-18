import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => context.userData, getAppPath: () => process.cwd(), isPackaged: false },
  dialog: {},
}));
import { createRuntime } from '../electron/runtime';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('test-results', 'update-'));
  roots.push(root);
  context.userData = path.join(root, 'user');
  return createRuntime(root, {});
}

describe('launcher update runtime guard', () => {
  it('blocks gameplay, save synchronization, exclusive work and concurrent requests', async () => {
    const runtime = await fixture();
    runtime.assertUpdateIdle();
    vi.spyOn(runtime.pcsx2, 'running', 'get').mockReturnValue(true);
    expect(() => runtime.assertUpdateIdle()).toThrow('Close PCSX2');
    vi.restoreAllMocks();
    vi.spyOn(runtime.autoSync, 'busy', 'get').mockReturnValue(true);
    expect(() => runtime.assertUpdateIdle()).toThrow();
    vi.restoreAllMocks();
    await runtime.exclusive(async () => {
      expect(() => runtime.assertUpdateIdle()).toThrow();
    });
    await runtime.request('fixture', () =>
      runtime.request('launcher-update:confirm', async () => {
        expect(() => runtime.assertUpdateIdle()).toThrow();
      }),
    );
    runtime.assertUpdateIdle();
  });
  it('blocks queued transfers and freezes new requests before installer handoff', async () => {
    const runtime = await fixture();
    vi.spyOn(runtime.transfers, 'active', 'get').mockReturnValue(true);
    expect(() => runtime.installLauncherUpdate(() => {})).toThrow();
    expect(runtime.installingUpdate).toBe(false);
    vi.restoreAllMocks();
    runtime.installLauncherUpdate(() => {
      expect(runtime.installingUpdate).toBe(true);
    });
    await expect(runtime.request('emulator:open', vi.fn())).rejects.toThrow('update is installing');
    runtime.updateInstallationFailed();
    await expect(runtime.request('fixture', () => 42)).resolves.toBe(42);
  });
});
