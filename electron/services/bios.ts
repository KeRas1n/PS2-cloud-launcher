import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BiosImage } from '../../shared/types';

// Structural ROM-directory check, not a copyright database or a bundled BIOS.
export function inspectBios(bytes: Buffer): Omit<BiosImage, 'name'> | undefined {
  if (bytes.length < 512 * 1024 || bytes.length > 8 * 1024 * 1024) return;
  for (let table = 0; table + 16 <= bytes.length; table += 16) {
    if (bytes.toString('ascii', table, table + 6) !== 'RESET\0') continue;
    let offset = 0;
    for (let row = table; row + 16 <= bytes.length; row += 16) {
      const raw = bytes.subarray(row, row + 10),
        end = raw.indexOf(0);
      if (end <= 0) break;
      const name = raw.toString('ascii', 0, end),
        length = bytes.readUInt32LE(row + 12);
      if (offset + length > bytes.length) break;
      if (name === 'ROMVER' && length >= 14) {
        const version = bytes.toString('ascii', offset, offset + 14);
        if (!/^\d{4}[A-Z][A-Z]\d{8}$/.test(version)) break;
        const regions: Record<string, string> = {
          A: 'USA',
          E: 'Europe',
          J: 'Japan',
          H: 'Asia',
          C: 'China',
          T: 'Development',
          X: 'Test',
          P: 'Free',
        };
        return {
          version: `${version.slice(0, 2)}.${version.slice(2, 4)}`,
          region: regions[version[4]] ?? version[4],
        };
      }
      offset += Math.ceil(length / 16) * 16;
      if (offset > bytes.length) break;
    }
  }
}
export async function readBios(file: string): Promise<Omit<BiosImage, 'name'> | undefined> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size < 512 * 1024 || stat.size > 8 * 1024 * 1024) return;
    return inspectBios(await fs.readFile(file));
  } catch {
    return;
  }
}
export async function listBios(directory: string): Promise<BiosImage[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }
  const images: BiosImage[] = [];
  for (const name of names.sort()) {
    if (/[\0\r\n]/.test(name)) continue;
    const details = await readBios(path.join(directory, name));
    if (details) images.push({ name, ...details });
  }
  return images;
}
