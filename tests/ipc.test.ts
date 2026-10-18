import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { WindowReference } from '../electron/window';

const registered = vi.hoisted(() => new Map<string, (...args: any[]) => Promise<unknown>>());
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, callback: (...args: any[]) => Promise<unknown>) =>
      registered.set(channel, callback),
  },
}));
import { createIpcHandler } from '../electron/ipc/handle';

beforeEach(() => registered.clear());

function fixture(devUrl?: string) {
  const rendererFile = path.resolve('dist/index.html');
  const mainFrame = { url: devUrl ?? pathToFileURL(rendererFile).href };
  const webContents = { mainFrame };
  const windows = { current: { webContents } } as unknown as WindowReference;
  const action = vi.fn(async (value: string) => value);
  const handle = createIpcHandler(windows, devUrl, rendererFile);
  handle('fixture', action);
  return {
    windows,
    action,
    handle,
    mainFrame,
    webContents,
    event: { sender: webContents, senderFrame: mainFrame },
    invoke: (...args: any[]) => registered.get('fixture')!(...args),
  };
}

describe('shared IPC boundary', () => {
  it('accepts the main renderer in development and packaged mode', async () => {
    for (const devUrl of ['http://127.0.0.1:5173', undefined]) {
      const f = fixture(devUrl);
      await expect(f.invoke(f.event, 'payload')).resolves.toBe('payload');
      expect(f.action).toHaveBeenCalledWith('payload');
    }
  });

  it('rejects another window, a child frame and a missing sender frame before running a route', async () => {
    const f = fixture();
    for (const event of [
      { ...f.event, sender: {} },
      { ...f.event, senderFrame: { ...f.mainFrame } },
      { ...f.event, senderFrame: undefined },
    ])
      await expect(f.invoke(event)).rejects.toThrow('Untrusted IPC sender.');
    expect(f.action).not.toHaveBeenCalled();
  });

  it('rejects foreign origins and different packaged files', async () => {
    for (const devUrl of ['http://127.0.0.1:5173', undefined]) {
      const f = fixture(devUrl);
      f.mainFrame.url = devUrl ? 'https://example.invalid' : pathToFileURL(path.resolve('other.html')).href;
      await expect(f.invoke(f.event)).rejects.toThrow('Untrusted IPC sender.');
      expect(f.action).not.toHaveBeenCalled();
    }
  });

  it('rejects requests after the application window closes', async () => {
    const f = fixture();
    f.windows.current = undefined;
    await expect(f.invoke(f.event)).rejects.toThrow('Untrusted IPC sender.');
    expect(f.action).not.toHaveBeenCalled();
  });

  it('preserves route errors and normalizes validation errors', async () => {
    const f = fixture();
    f.handle('fixture', (value) => z.object({ name: z.string() }).parse(value));
    await expect(f.invoke(f.event, {})).rejects.toThrow('name: Required');
    f.handle('fixture', () => {
      throw new Error('Close PCSX2 first.');
    });
    await expect(f.invoke(f.event)).rejects.toThrow('Close PCSX2 first.');
  });
});
