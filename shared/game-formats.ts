// PCSX2 VMManager::IsLoadableFileName (disc images, ELF and diagnostic dumps).
// https://github.com/PCSX2/pcsx2/blob/master/pcsx2/VMManager.cpp
// CUE/TOC are descriptors, not bootable images; PCSX2 opens the associated BIN.
export const gameExtensions = [
  'gs.xz',
  'gs.zst',
  'iso',
  'bin',
  'img',
  'mdf',
  'gz',
  'cso',
  'zso',
  'chd',
  'elf',
  'dump',
  'gs',
] as const;
export const supportedGameFormats = 'ISO, BIN, IMG, MDF, GZ, CSO, ZSO, CHD, ELF, DUMP, GS, GS.XZ, GS.ZST';
export function gameExtension(name: string): string | undefined {
  const lower = name.toLowerCase();
  return gameExtensions.find((extension) => lower.endsWith(`.${extension}`));
}
export const isGame = (name: string) => gameExtension(name) !== undefined;
export function gameTitle(name: string) {
  const extension = gameExtension(name);
  let title = extension ? name.slice(0, -extension.length - 1) : name;
  if (extension === 'gz') title = title.replace(/\.(iso|bin|img|mdf)$/i, '');
  return title.replace(/_/g, ' ');
}
