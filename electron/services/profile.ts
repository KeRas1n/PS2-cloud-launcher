import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { EmulatorProfile } from '../../shared/types';
import { SettingsStore } from './settings';
import { exists, atomicText, walk } from './files';
import { listBios, readBios } from './bios';
import { readIni, writeIni, mergeIniDefaults } from './ini';
import { run } from './process';

export class PCSX2ProfileService {
  constructor(private store: SettingsStore) {}
  async dataRoot(binary?: string): Promise<string> {
    if (binary) {
      const directory = path.dirname(binary);
      if (
        (await exists(path.join(directory, 'portable.txt'))) ||
        (await exists(path.join(directory, 'portable.ini')))
      ) {
        if (process.platform === 'linux' && /\.AppImage$/i.test(binary)) return path.join(directory, 'PCSX2');
        const pointer = await fs.readFile(path.join(directory, 'portable.txt'), 'utf8').catch(() => '');
        return path.resolve(directory, pointer.trim());
      }
    }
    // PCSX2 2.x appends this directory to -datapath; it is NOT the INI directory itself.
    return path.join(this.store.value.dataDirectory, 'PCSX2');
  }
  private async current(binary?: string) {
    const root = await this.dataRoot(binary),
      file = path.join(root, 'inis', 'PCSX2.ini');
    return { root, file, ini: await fs.readFile(file, 'utf8').catch(() => '') };
  }
  async inspect(binary?: string): Promise<EmulatorProfile> {
    const { root, ini } = await this.current(binary);
    const images = await listBios(this.store.value.biosDirectory);
    const configured = readIni(ini, 'Filenames', 'BIOS');
    const selected = images.find((image) => image.name === configured)?.name ?? images[0]?.name;
    const prepared =
      !!readIni(ini, 'UI', 'SettingsVersion') && readIni(ini, 'UI', 'SetupWizardIncomplete') === 'false';
    return { directory: root, bios: images, selectedBios: selected, prepared, ready: prepared && !!selected };
  }
  private async defaults(binary: string, existing: string): Promise<string> {
    const directory = path.dirname(binary);
    if (
      (await exists(path.join(directory, 'portable.txt'))) ||
      (await exists(path.join(directory, 'portable.ini')))
    ) {
      if (readIni(existing, 'UI', 'SettingsVersion')) return existing;
      throw new Error(
        'This external portable PCSX2 profile is not initialized. Install a managed PCSX2 copy in Emulator to configure it without emulator windows.',
      );
    }
    const stat = await fs.stat(binary);
    const key = createHash('sha256').update(`${binary}:${stat.size}:${stat.mtimeMs}`).digest('hex');
    const cache = path.join(this.store.userData, 'profiles', `${key}.ini`);
    if (await exists(cache)) return fs.readFile(cache, 'utf8');
    const scratchParent = path.join(this.store.userData, 'profiles');
    await fs.mkdir(scratchParent, { recursive: true });
    const scratch = await fs.mkdtemp(path.join(scratchParent, 'initialize-'));
    try {
      // A fresh profile avoids the reset-settings prompt. -testconfig exits before
      // the setup wizard and main window are constructed. Do not use -portable.
      await run(binary, ['-testconfig', '-datapath', scratch], { timeout: 30_000, cwd: directory });
      const generated = await fs.readFile(path.join(scratch, 'PCSX2', 'inis', 'PCSX2.ini'), 'utf8');
      if (!/^\d+$/.test(readIni(generated, 'UI', 'SettingsVersion') ?? ''))
        throw new Error('PCSX2 did not generate a valid configuration.');
      await atomicText(cache, generated);
      return generated;
    } finally {
      await fs.rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
    }
  }
  private async preserveLegacyDirectories(root: string, ini: string) {
    const original = this.store.value,
      updated = { ...original };
    for (const [key, field, folder] of [
      ['MemoryCards', 'memcardsDirectory', 'memcards'],
      ['Savestates', 'saveStatesDirectory', 'sstates'],
      ['Bios', 'biosDirectory', 'bios'],
    ] as const) {
      const previous = path.resolve(root, readIni(ini, 'Folders', key) || folder);
      const configured = original[field];
      if (
        path.resolve(configured) !== path.resolve(original.dataDirectory, folder) ||
        previous === configured
      )
        continue;
      const files = async (dir: string) => (await walk(dir).catch(() => [])).length;
      if ((await files(previous)) && !(await files(configured))) updated[field] = previous;
    }
    if (JSON.stringify(updated) !== JSON.stringify(original)) await this.store.save(updated);
  }
  async prepare(binary: string, requireBios = false, selectedBios?: string): Promise<EmulatorProfile> {
    const { root, file, ini } = await this.current(binary);
    await this.preserveLegacyDirectories(root, ini);
    const s = this.store.value;
    const bios = await listBios(s.biosDirectory);
    if (selectedBios && !bios.some((image) => image.name === selectedBios))
      throw new Error('Selected BIOS is missing or invalid. Import your own PS2 BIOS in Emulator.');
    const previous = readIni(ini, 'Filenames', 'BIOS');
    const selected = selectedBios ?? bios.find((image) => image.name === previous)?.name ?? bios[0]?.name;
    if (requireBios && !selected)
      throw new Error(
        'No valid PS2 BIOS found. Open Emulator and import a BIOS dumped from your own console before playing.',
      );
    const defaults = await this.defaults(binary, ini);
    let configured = mergeIniDefaults(ini, defaults);
    // Recover any preferences written by older launcher builds to the wrong INI.
    if (!ini)
      configured = mergeIniDefaults(
        await fs.readFile(path.join(s.dataDirectory, 'inis', 'PCSX2.ini'), 'utf8').catch(() => ''),
        configured,
      );
    configured = writeIni(configured, 'UI', {
      SettingsVersion: readIni(defaults, 'UI', 'SettingsVersion')!,
      SetupWizardIncomplete: 'false',
      Language: 'en',
      ConfirmShutdown: 'false',
      RenderToSeparateWindow: 'true',
      StartBigPictureMode: 'false',
      PromptOnStateLoadSaveFailure: 'false',
    });
    configured = writeIni(configured, 'Folders', {
      Bios: s.biosDirectory.replace(/\\/g, '/'),
      MemoryCards: s.memcardsDirectory.replace(/\\/g, '/'),
      Savestates: s.saveStatesDirectory.replace(/\\/g, '/'),
    });
    configured = writeIni(configured, 'AutoUpdater', { CheckAtStartup: 'false' });
    configured = writeIni(configured, 'Logging', { EnableSystemConsole: 'false', EnableFileLogging: 'true' });
    if (selected) configured = writeIni(configured, 'Filenames', { BIOS: selected });
    await fs.mkdir(path.dirname(file), { recursive: true });
    for (const directory of [s.biosDirectory, s.memcardsDirectory, s.saveStatesDirectory])
      await fs.mkdir(directory, { recursive: true });
    if (configured !== ini) {
      if (ini) await fs.copyFile(file, `${file}.launcher-backup-${randomUUID()}`, constants.COPYFILE_EXCL);
      await atomicText(file, configured);
    }
    return this.inspect(binary);
  }
  async importBios(file: string) {
    if (!(await readBios(file)))
      throw new Error(
        'This file is not a valid PS2 BIOS image. Import an uncompressed BIOS dumped from your own console.',
      );
    await fs.mkdir(this.store.value.biosDirectory, { recursive: true });
    const destination = path.join(this.store.value.biosDirectory, path.basename(file));
    if (path.resolve(file) !== path.resolve(destination))
      await fs.copyFile(file, destination, constants.COPYFILE_EXCL);
    return path.basename(file);
  }
}
