import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { LauncherUpdateService } from '../electron/services/launcher-update';

function fixture() {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  });
  const changed = vi.fn();
  let busy = false;
  const assertIdle = vi.fn(() => {
    if (busy) throw new Error('Busy');
  });
  const install = vi.fn((action: () => void) => {
    assertIdle();
    action();
  });
  const service = new LauncherUpdateService(updater as never, changed, assertIdle, install);
  return {
    updater,
    changed,
    service,
    install,
    busy: (value: boolean) => {
      busy = value;
    },
  };
}

describe('launcher update consent and activity protection', () => {
  it('checks silently without downloading, installing, or offering current versions', async () => {
    const f = fixture();
    expect(f.updater.autoDownload).toBe(false);
    expect(f.updater.autoInstallOnAppQuit).toBe(false);
    expect(f.updater.allowPrerelease).toBe(false);
    await f.service.check();
    expect(f.changed).not.toHaveBeenCalled();
    f.updater.checkForUpdates.mockRejectedValue(new Error('Offline / missing repository'));
    f.updater.emit('error', new Error('Offline'));
    await expect(f.service.check()).resolves.toBeUndefined();
    expect(f.changed).not.toHaveBeenCalled();
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('Later dismisses an available update without downloading', async () => {
    const f = fixture();
    f.updater.emit('update-available', { version: '0.2.0' });
    f.service.later();
    expect(f.service.state).toEqual({ status: 'available', version: '0.2.0', hidden: true });
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('downloads and installs only after confirmation while idle', async () => {
    const f = fixture();
    await f.service.confirm();
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled();
    f.updater.emit('update-available', { version: '0.2.0' });
    await f.service.confirm();
    expect(f.updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(f.install).toHaveBeenCalledOnce();
    expect(f.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
  it('rejects confirmation during activity before starting any download', async () => {
    const f = fixture();
    f.updater.emit('update-available', { version: '0.2.0' });
    f.busy(true);
    await expect(f.service.confirm()).rejects.toThrow('Busy');
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });
  it('defers installation if activity starts during download; later confirmation reuses download', async () => {
    const f = fixture();
    f.updater.emit('update-available', { version: '0.2.0' });
    f.updater.downloadUpdate.mockImplementation(async () => {
      f.busy(true);
      return [];
    });
    await f.service.confirm();
    expect(f.service.state.status).toBe('ready');
    expect(f.install).not.toHaveBeenCalled();
    f.service.later();
    expect(f.service.state.hidden).toBe(true);
    f.busy(false);
    await f.service.confirm();
    expect(f.updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(f.install).toHaveBeenCalledOnce();
  });
  it('ignores repeat clicks during download and permits retry after failure', async () => {
    const f = fixture();
    f.updater.emit('update-available', { version: '0.2.0' });
    let reject!: (error: Error) => void;
    f.updater.downloadUpdate.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const download = f.service.confirm();
    await f.service.confirm();
    expect(f.updater.downloadUpdate).toHaveBeenCalledOnce();
    reject(new Error('Checksum / network failure'));
    await download;
    expect(f.service.state.status).toBe('available');
    expect(f.service.state.error).toContain('failed');
    expect(f.install).not.toHaveBeenCalled();
    f.updater.downloadUpdate.mockResolvedValue([]);
    await f.service.confirm();
    expect(f.install).toHaveBeenCalledOnce();
  });
  it('reports installer errors after confirmation', async () => {
    const f = fixture();
    f.updater.emit('update-available', { version: '0.2.0' });
    f.updater.quitAndInstall.mockImplementation(() => {
      f.updater.emit('error', new Error('Installer unavailable'));
    });
    await f.service.confirm();
    expect(f.service.state.status).toBe('ready');
    expect(f.service.state.error).toContain('Could not install');
  });
});
