import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { Settings } from '../../shared/types';
import { atomicJson } from './files';

const absolute = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (p) => path.isAbsolute(p) && !/[\0\r\n]/.test(p),
    'Use an absolute path without control characters.',
  );
export const settingsSchema = z
  .object({
    gameDirectories: z.array(absolute).max(50),
    downloadDirectory: absolute,
    emulatorRoot: absolute,
    pcsx2Path: z.union([absolute, z.literal('')]),
    dataDirectory: absolute,
    biosDirectory: absolute,
    memcardsDirectory: absolute,
    saveStatesDirectory: absolute,
    rclonePath: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (p) => (p === 'rclone' || path.isAbsolute(p)) && !/[\0\r\n]/.test(p),
        'Choose an absolute Rclone path or rclone.',
      ),
    rcloneConfig: absolute,
    remote: z
      .string()
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/,
        'Remote names can contain letters, numbers, underscores and hyphens.',
      ),
    cloudRoot: z
      .string()
      .max(512)
      .refine(
        (p) =>
          p === '' ||
          (!p.startsWith('/') &&
            !p.includes('\\') &&
            !p.includes(':') &&
            !/[\0\r\n]/.test(p) &&
            p.split('/').every((s) => s && s !== '..' && s !== '.')),
        'Use a relative cloud folder.',
      ),
    fullscreen: z.boolean(),
  })
  .strict();

export class SettingsStore {
  value!: Settings;
  constructor(
    public readonly userData: string,
    private readonly launcherDir: string,
  ) {}
  async load() {
    let root = path.join(this.launcherDir, 'emulator');
    try {
      await fs.mkdir(root, { recursive: true });
      const probe = path.join(root, `.write-test-${process.pid}`);
      await fs.writeFile(probe, '');
      await fs.unlink(probe);
    } catch {
      root = path.join(this.userData, 'emulator');
    }
    const data = path.join(root, 'data');
    this.value = {
      gameDirectories: [],
      downloadDirectory: path.join(this.userData, 'Games'),
      emulatorRoot: root,
      pcsx2Path: '',
      dataDirectory: data,
      biosDirectory: path.join(data, 'bios'),
      memcardsDirectory: path.join(data, 'memcards'),
      saveStatesDirectory: path.join(data, 'sstates'),
      rclonePath: 'rclone',
      rcloneConfig: path.join(this.userData, 'credentials', 'rclone.conf'),
      remote: 'ps2-dropbox',
      cloudRoot: 'PS2Cloud',
      fullscreen: true,
    };
    try {
      this.value = this.validate(
        JSON.parse(await fs.readFile(path.join(this.userData, 'settings.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          'Settings file is invalid. Repair settings.json in the launcher user data directory.',
        );
    }
    return this.value;
  }
  async save(input: unknown) {
    const settings = this.validate(input);
    await atomicJson(path.join(this.userData, 'settings.json'), settings);
    this.value = settings;
    return settings;
  }
  private validate(input: unknown) {
    const settings = settingsSchema.parse(input);
    const contains = (parent: string, child: string) => {
      const relative = path.relative(path.resolve(parent), path.resolve(child));
      return (
        relative === '' ||
        (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
      );
    };
    const saveDirs = [settings.memcardsDirectory, settings.saveStatesDirectory, settings.biosDirectory];
    if (saveDirs.some((folder, i) => saveDirs.some((other, j) => i !== j && contains(folder, other))))
      throw new Error('BIOS, memory cards and save states need separate, non-overlapping directories.');
    const backups = path.join(this.userData, 'backups');
    for (const folder of [settings.memcardsDirectory, settings.saveStatesDirectory]) {
      if (
        contains(folder, this.userData) ||
        contains(folder, settings.rcloneConfig) ||
        contains(folder, backups) ||
        contains(backups, folder)
      )
        throw new Error(
          'Save sync directories must not contain launcher credentials, preferences, or backups.',
        );
    }
    return settings;
  }
}
