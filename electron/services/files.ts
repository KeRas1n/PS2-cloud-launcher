import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
export async function atomicJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export function safeRelative(value: string): string {
  if (
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.includes(':') ||
    value.startsWith('/') ||
    value.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('Unsafe relative file path.');
  return value;
}
export function within(root: string, relative: string): string {
  safeRelative(relative);
  const target = path.resolve(root, ...relative.split('/'));
  const resolved = path.relative(path.resolve(root), target);
  if (!resolved || resolved === '..' || resolved.startsWith('..' + path.sep) || path.isAbsolute(resolved))
    throw new Error('File is outside the selected directory.');
  return target;
}
export interface DiskFile {
  path: string;
  absolute: string;
  size: number;
  modified: string;
}
export async function walk(root: string): Promise<DiskFile[]> {
  const result: DiskFile[] = [];
  async function visit(dir: string) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink() || item.name.startsWith('.')) continue;
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) await visit(absolute);
      else if (item.isFile()) {
        const stat = await fs.stat(absolute);
        result.push({
          path: path.relative(root, absolute).split(path.sep).join('/'),
          absolute,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }
  }
  await visit(root);
  return result;
}
