import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { RcloneRemoteControl, sampleTransfer, splitFileLocation } from '../electron/services/rclone-rc';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps remote backup paths relative to the destination directory', async () => {
  const control = new RcloneRemoteControl();
  const request = vi.spyOn(control, 'request').mockResolvedValue({});
  const local = path.resolve('test-results', 'nested', 'card.ps2');
  await control.command('rclone', 'config', undefined, [
    'copyto',
    local,
    'ps2-mega:PS2Cloud/Memcards/nested/card.ps2',
    '--backup-dir',
    'ps2-mega:PS2Cloud/Backups/id/Memcards/nested',
    '--ignore-times',
  ]);
  expect(request).toHaveBeenCalledWith(
    'rclone',
    'config',
    undefined,
    'operations/copyfile',
    {
      srcFs: path.dirname(local),
      srcRemote: 'card.ps2',
      dstFs: 'ps2-mega:PS2Cloud/Memcards/nested',
      dstRemote: 'card.ps2',
      _config: { BackupDir: 'ps2-mega:PS2Cloud/Backups/id/Memcards/nested', IgnoreTimes: true },
      _group: expect.stringMatching(/^launcher-/),
    },
    24 * 60 * 60 * 1000,
  );
  expect(splitFileLocation('ps2-mega:card.ps2')).toEqual({ fs: 'ps2-mega:', remote: 'card.ps2' });
});

it('uses persistent API operations for listing and copy, never a terminal command', async () => {
  const control = new RcloneRemoteControl();
  const request = vi.spyOn(control, 'request').mockResolvedValue({ list: [{ Path: 'nested/card.ps2' }] });
  expect(
    JSON.parse(
      await control.command('rclone', 'config', undefined, [
        'lsjson',
        'ps2-mega:PS2Cloud/Memcards',
        '--recursive',
        '--files-only',
      ]),
    ),
  ).toEqual([{ Path: 'nested/card.ps2' }]);
  await control.command('rclone', 'config', undefined, ['mkdir', 'ps2-mega:PS2Cloud/Memcards']);
  await control.command('rclone', 'config', undefined, [
    'copy',
    'ps2-mega:PS2Cloud/Memcards',
    path.resolve('test-results/cache'),
    '--ignore-times',
  ]);
  expect(request.mock.calls.map((call) => call[3])).toEqual([
    'operations/list',
    'operations/mkdir',
    'sync/copy',
    'core/stats',
    'core/stats-delete',
  ]);
  expect(request.mock.calls[0][4]).toMatchObject({ fs: 'ps2-mega:PS2Cloud/Memcards', remote: '' });
});

it('measures current bytes per second independently of Rclone cumulative averages', () => {
  const sample = sampleTransfer(
    { bytes: 5 * 1024 * 1024, totalBytes: 10 * 1024 * 1024, speed: 50 * 1024 },
    { bytes: 1024 * 1024, time: 1000 },
    2000,
    0,
  );
  expect(sample.speed).toBe(4 * 1024 * 1024);
  expect(sample.averageSpeed).toBe(2.5 * 1024 * 1024);
  expect(sample.percent).toBe(50);
  expect(sampleTransfer({ bytes: 1024 }, { bytes: 1024, time: 1000 }, 2000, 0).speed).toBe(0);
  expect(sampleTransfer({ bytes: 0 }, { bytes: 1024, time: 1000 }, 2000, 0).speed).toBe(0);
});

it('isolates each transfer stats group and forwards multi-thread test options', async () => {
  const control = new RcloneRemoteControl();
  const request = vi.spyOn(control, 'request').mockResolvedValue({ bytes: 4096, totalBytes: 4096, speed: 1 });
  const progress = vi.fn();
  for (let i = 0; i < 2; i++)
    await control.command(
      'rclone',
      'config',
      undefined,
      [
        'copyto',
        'ps2-mega:image.iso',
        path.resolve(`test-results/image-${i}.iso`),
        '--multi-thread-streams',
        '4',
        '--multi-thread-cutoff',
        '64Mi',
        '--multi-thread-chunk-size',
        '16Mi',
      ],
      progress,
    );
  const transfers = request.mock.calls.filter((call) => call[3] === 'operations/copyfile');
  const first = transfers[0][4] as any,
    second = transfers[1][4] as any;
  expect(first._group).not.toBe(second._group);
  expect(first._config).toMatchObject({
    MultiThreadStreams: 4,
    MultiThreadCutoff: '64Mi',
    MultiThreadChunkSize: '16Mi',
  });
  const groups = request.mock.calls
    .filter((call) => call[3] === 'core/stats')
    .map((call) => (call[4] as any).group);
  expect(groups).toEqual([first._group, second._group]);
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 4096, totalBytes: 4096 }));
  expect(request.mock.calls.some((call) => call[3] === 'core/stats-reset')).toBe(false);
});

it('never returns RC error bodies that may echo account secrets', async () => {
  const control = new RcloneRemoteControl();
  vi.spyOn(control as any, 'start').mockResolvedValue('http://127.0.0.1:12345/');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{"password":"SecretFixturePassword"}', { status: 500 })),
  );
  const error = await control
    .request('rclone', 'config', undefined, 'config/create', { pass: 'SecretFixturePassword' })
    .catch((error) => error);
  expect(error.message).toContain('MEGA operation failed');
  expect(error.message).not.toContain('SecretFixturePassword');
});

it('does not restart a disposed daemon for metrics cleanup after a failed transfer', async () => {
  const control = new RcloneRemoteControl();
  const request = vi
    .spyOn(control, 'request')
    .mockImplementation(async (_binary, _config, _code, endpoint) => {
      if (endpoint === 'operations/copyfile') {
        control.dispose();
        throw new Error('stopped');
      }
      return {};
    });
  await expect(
    control.command('rclone', 'config', undefined, [
      'copyto',
      'ps2-mega:file.iso',
      path.resolve('test-results/file.iso'),
    ]),
  ).rejects.toThrow('stopped');
  expect(request.mock.calls.map((call) => call[3])).toEqual(['operations/copyfile']);
});
