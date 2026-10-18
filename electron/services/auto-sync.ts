import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { Direction, Progress } from '../../shared/types';
import { SettingsStore } from './settings';
import { RcloneService } from './rclone';
import { atomicJson, exists, walk, within } from './files';
import { fingerprint, makeFiles, rejectSymlinks } from './sync';

type Kind = 'Memcards' | 'SaveStates';
interface SaveFile {
  path: string;
  size: number;
  modified: string;
  hash: string;
  absolute: string;
}
interface Group {
  kind: Kind;
  root: string;
  remote: string;
  local: SaveFile[];
  cloud: SaveFile[];
  metadata: string;
}
export interface SaveConflict {
  kind: Kind;
  path: string;
}
export class SyncCancelled extends Error {
  constructor() {
    super('Save synchronization cancelled.');
  }
}
async function hashFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function files(root: string): Promise<SaveFile[]> {
  await rejectSymlinks(root);
  if (!(await exists(root))) return [];
  const result = [];
  for (const file of await walk(root)) result.push({ ...file, hash: await hashFile(file.absolute) });
  // Also validates case collisions within a single side.
  makeFiles(result, []);
  return result;
}
function snapshotMatches(snapshot: SaveFile[], remote: { path: string; size: number }[]) {
  // Filesystem timestamps can round while cloud timestamps truncate sub-milliseconds.
  // Remote metadata is checked independently before/after each successful download.
  const normalize = (entries: { path: string; size: number }[]) =>
    entries.map(({ path, size }) => ({ path, size, modified: '' }));
  return fingerprint(normalize(snapshot), []) === fingerprint(normalize(remote), []);
}
export function saveDecision(
  local?: string,
  cloud?: string,
  baseline?: string,
): Direction | 'conflict' | undefined {
  if (local === cloud) return;
  if (!local) return 'download';
  if (!cloud) return 'upload';
  if (baseline === local) return 'download';
  if (baseline === cloud) return 'upload';
  return 'conflict';
}

export class AutoSyncService {
  busy = false;
  constructor(
    private store: SettingsStore,
    private rclone: RcloneService,
    private emit: (p: Progress) => void,
    private resolve: (conflicts: SaveConflict[]) => Promise<Direction | undefined>,
    private running: () => boolean,
  ) {}
  private async metadata(remote: string) {
    return (await this.rclone.list(remote)).map((f) => ({
      path: f.Path,
      size: f.Size,
      modified: new Date(f.ModTime).toISOString(),
    }));
  }
  async synchronize() {
    if (this.busy || this.running()) throw new Error('Close PCSX2 before synchronizing saves.');
    this.busy = true;
    const staging = path.join(this.store.userData, 'auto-sync', randomUUID());
    try {
      this.emit({ operation: 'auto-sync', message: 'Checking cloud saves…', saveSyncRunning: true });
      await fs.mkdir(staging, { recursive: true, mode: 0o700 });
      await this.rclone.ensureFolders();
      const s = this.store.value;
      const namespace = createHash('sha256')
        .update(
          JSON.stringify([
            s.cloudProvider,
            s.rcloneConfig,
            s.remote,
            s.cloudRoot,
            s.memcardsDirectory,
            s.saveStatesDirectory,
          ]),
        )
        .digest('hex');
      const stateFile = path.join(this.store.userData, 'auto-sync', `${namespace}.json`);
      let baseline: Record<string, string> = {};
      try {
        const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
        if (
          !state ||
          Array.isArray(state) ||
          typeof state !== 'object' ||
          Object.values(state).some((v) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
        )
          throw new Error('Invalid save sync history.');
        baseline = state;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const groups: Group[] = [];
      for (const kind of ['Memcards', 'SaveStates'] as const) {
        const root = kind === 'Memcards' ? s.memcardsDirectory : s.saveStatesDirectory;
        const remote = this.rclone.remote(kind);
        const before = await this.metadata(remote);
        const cache = path.join(staging, kind);
        await fs.mkdir(cache, { recursive: true });
        // Download a stable snapshot for content hashes; timestamps alone cannot resolve conflicts.
        await this.rclone.call(['copy', remote, cache, '--ignore-times'], (p) =>
          this.emit({ ...p, operation: 'auto-sync', message: `Checking ${kind}…` }),
        );
        const cloud = await files(cache);
        makeFiles(cloud, before);
        if (
          fingerprint(before, []) !== fingerprint(await this.metadata(remote), []) ||
          !snapshotMatches(cloud, before)
        )
          throw new Error('Cloud saves changed during download. Retry synchronization.');
        const local = await files(root);
        makeFiles(local, cloud);
        makeFiles(cloud, local);
        groups.push({ kind, root, remote, local, cloud, metadata: fingerprint(before, []) });
      }
      const tasks: { group: Group; name: string; direction: Direction | 'conflict' }[] = [];
      for (const group of groups) {
        const local = new Map(group.local.map((f) => [f.path, f.hash]));
        const cloud = new Map(group.cloud.map((f) => [f.path, f.hash]));
        for (const name of new Set([...local.keys(), ...cloud.keys()])) {
          const direction = saveDecision(local.get(name), cloud.get(name), baseline[`${group.kind}/${name}`]);
          if (direction) tasks.push({ group, name, direction });
        }
      }
      const conflicts = tasks.filter((t) => t.direction === 'conflict');
      const choice = conflicts.length
        ? await this.resolve(conflicts.map((t) => ({ kind: t.group.kind, path: t.name })))
        : undefined;
      if (conflicts.length && !choice) throw new SyncCancelled();
      // No writes before every conflict has a decision and both sides pass a fresh check.
      for (const group of groups) {
        const current = await files(group.root);
        if (
          JSON.stringify(current.map((f) => [f.path, f.hash]).sort()) !==
            JSON.stringify(group.local.map((f) => [f.path, f.hash]).sort()) ||
          group.metadata !== fingerprint(await this.metadata(group.remote), [])
        )
          throw new Error('Saves changed during synchronization. Retry before playing.');
      }
      const transferId = randomUUID();
      for (const task of tasks) {
        if (this.running()) throw new Error('Close PCSX2 before synchronizing saves.');
        const { group, name } = task;
        const direction = task.direction === 'conflict' ? choice! : task.direction;
        const local = within(group.root, name);
        const remote = `${group.remote}/${name}`;
        await rejectSymlinks(local);
        const expected = group.local.find((f) => f.path === name)?.hash;
        const actual = (await exists(local)) ? await hashFile(local) : undefined;
        if (actual !== expected || group.metadata !== fingerprint(await this.metadata(group.remote), []))
          throw new Error('Saves changed before replacement. Retry synchronization.');
        const backup =
          direction === 'upload'
            ? `${this.rclone.remote()}/Backups/${transferId}/${group.kind}/${path.posix.dirname(name)}`
            : path.join(this.store.userData, 'backups', transferId, group.kind, path.posix.dirname(name));
        const source = direction === 'upload' ? local : group.cloud.find((f) => f.path === name)!.absolute;
        if (direction === 'download') {
          await fs.mkdir(path.dirname(local), { recursive: true });
          await rejectSymlinks(backup);
          await fs.mkdir(backup, { recursive: true });
        }
        this.emit({
          operation: 'auto-sync',
          message: `${direction === 'upload' ? 'Uploading' : 'Downloading'} ${group.kind}/${name}`,
        });
        await this.rclone.call(
          [
            'copyto',
            source,
            direction === 'upload' ? remote : local,
            '--backup-dir',
            backup,
            '--ignore-times',
            '--retries',
            '3',
          ],
          (p) => this.emit({ ...p, operation: 'auto-sync', message: `Synchronizing ${group.kind}/${name}` }),
        );
        group.metadata = fingerprint(await this.metadata(group.remote), []);
      }
      // Verify actual content again. A failed/partial transfer never advances sync history.
      const next: Record<string, string> = {};
      for (const group of groups) {
        const verify = path.join(staging, 'verify', group.kind);
        await fs.mkdir(verify, { recursive: true });
        const before = await this.metadata(group.remote);
        await this.rclone.call(['copy', group.remote, verify, '--ignore-times']);
        const cloud = await files(verify);
        if (
          fingerprint(before, []) !== fingerprint(await this.metadata(group.remote), []) ||
          !snapshotMatches(cloud, before)
        )
          throw new Error('Cloud saves changed during verification. Retry synchronization.');
        const local = new Map((await files(group.root)).map((f) => [f.path, f.hash]));
        for (const file of cloud) {
          if (local.get(file.path) !== file.hash)
            throw new Error('Saves changed during verification. Retry synchronization.');
          next[`${group.kind}/${file.path}`] = file.hash;
          local.delete(file.path);
        }
        if (local.size)
          throw new Error('New local saves appeared during synchronization. Retry synchronization.');
      }
      await atomicJson(stateFile, next);
      this.emit({ operation: 'auto-sync', message: 'Cloud saves synchronized', percent: 100 });
    } finally {
      this.busy = false;
      this.emit({ operation: 'auto-sync', message: 'Save synchronization finished', saveSyncRunning: false });
      // Only this operation's private staging directory is removed.
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}
