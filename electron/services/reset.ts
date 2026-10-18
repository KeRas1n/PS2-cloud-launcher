import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Settings } from '../../shared/types';
import type { SettingsStore } from './settings';

// Deliberately exclude Games, emulator, backups and unknown user-created entries.
const launcherDirectories = [
  'credentials',
  'covers',
  'logs',
  'profiles',
  'auto-sync',
  'transfer-staging',
  'tools',
];
const browserDirectories = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Network',
  'WebStorage',
  'Service Worker',
];

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
}

async function resolvedLocation(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await resolvedLocation(parent), path.basename(file));
  }
}

export async function prepareLauncherReset(userData: string, settings: Settings) {
  const root = await fs.realpath(userData);
  const protectedPaths = [
    ...settings.gameDirectories,
    settings.downloadDirectory,
    settings.emulatorRoot,
    settings.pcsx2Path,
    settings.dataDirectory,
    settings.biosDirectory,
    settings.memcardsDirectory,
    settings.saveStatesDirectory,
    path.join(userData, 'backups'),
  ].filter(Boolean);
  const protectedLocations = await Promise.all(protectedPaths.map(resolvedLocation));
  const targets = launcherDirectories.map((name) => path.resolve(userData, name));
  // Validate every target before deleting anything. Refuse ambiguous/custom overlaps.
  for (const target of [
    ...targets,
    ...browserDirectories.map((name) => path.resolve(userData, name)),
    path.join(userData, 'settings.json'),
  ]) {
    if (!contains(path.resolve(userData), target) || target === path.resolve(userData))
      throw new Error('Unsafe launcher reset path.');
    const resolved = await resolvedLocation(target);
    if (!contains(root, resolved))
      throw new Error('Launcher data contains a link outside its data directory. Reset was cancelled.');
    if (
      protectedLocations.some(
        (protectedPath) => contains(resolved, protectedPath) || contains(protectedPath, resolved),
      ) ||
      protectedPaths.some(
        (protectedPath) =>
          contains(target, path.resolve(protectedPath)) || contains(path.resolve(protectedPath), target),
      )
    )
      throw new Error(
        'Launcher data overlaps a game, save or emulator path. Reset was cancelled to preserve your files.',
      );
  }
  return targets;
}

export async function deleteLauncherData(store: SettingsStore, targets: string[]) {
  // Revalidate after closing cloud clients and clearing browser storage.
  const validated = await prepareLauncherReset(store.userData, store.value);
  if (targets.length !== validated.length || targets.some((target, i) => target !== validated[i]))
    throw new Error('Launcher reset paths changed. Try again.');
  for (const target of validated)
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await store.resetPreferences();
}
