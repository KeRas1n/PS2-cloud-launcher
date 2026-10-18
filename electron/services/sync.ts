import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { Progress, SyncRequest, SyncPlan } from '../../shared/types';
import { SettingsStore } from './settings';
import { RcloneService } from './rclone';
import { GameService } from './games';
import { PCSX2Service } from './pcsx2';
import { exists, safeRelative, walk, within } from './files';

interface Entry {
  path: string;
  size: number;
  modified: string;
  absolute?: string;
}
export interface Prepared {
  plan: SyncPlan;
  request: SyncRequest;
  fingerprint: string;
  settings: string;
  expires: number;
}
export function makeFiles(source: Entry[], destination: Entry[]) {
  const existing = new Map(destination.map((f) => [f.path.toLowerCase(), f]));
  const seen = new Set<string>();
  return source.map((file) => {
    safeRelative(file.path);
    const key = file.path.toLowerCase();
    if (seen.has(key))
      throw new Error('Case-insensitive filename collision. Rename files before syncing across platforms.');
    seen.add(key);
    const previous = existing.get(key);
    if (previous && previous.path !== file.path)
      throw new Error(`Filename case conflict: ${file.path}. Rename files to match before syncing.`);
    return { path: file.path, size: file.size, replaces: !!previous, previousSize: previous?.size };
  });
}
export function fingerprint(source: Entry[], destination: Entry[]) {
  const normalize = (entries: Entry[]) =>
    entries
      .map(({ path, size, modified }) => ({ path, size, modified }))
      .sort((a, b) => a.path.localeCompare(b.path));
  return createHash('sha256')
    .update(JSON.stringify([normalize(source), normalize(destination)]))
    .digest('hex');
}
export async function rejectSymlinks(target: string) {
  const absolute = path.resolve(target),
    parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error('Symbolic links are not allowed as synchronization destinations.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
export class SyncService {
  private plans = new Map<string, Prepared>();
  busy = false;
  constructor(
    private store: SettingsStore,
    private rclone: RcloneService,
    private games: GameService,
    private pcsx2: PCSX2Service,
    private emit: (p: Progress) => void,
    private background = false,
    private signal?: AbortSignal,
  ) {}
  private localRoot(request: SyncRequest) {
    const s = this.store.value;
    return request.kind === 'Games'
      ? s.downloadDirectory
      : request.kind === 'Memcards'
        ? s.memcardsDirectory
        : s.saveStatesDirectory;
  }
  private async entries(request: SyncRequest) {
    const root = this.localRoot(request);
    let local: Entry[], remote: Entry[];
    if (request.kind === 'Games') {
      if (!request.gameId) throw new Error('Select a game to transfer.');
      const game = this.games.get(request.gameId);
      const relative = safeRelative(game.cloudPath ?? game.name);
      local = [];
      const file = request.direction === 'upload' ? game.localPath : within(root, relative);
      if (file && (await exists(file))) {
        const stat = await fs.stat(file);
        local.push({ path: relative, size: stat.size, modified: stat.mtime.toISOString(), absolute: file });
      }
      remote = (await this.rclone.list(this.rclone.remote('Games')))
        .filter((f) => f.Path.toLowerCase() === relative.toLowerCase())
        .map((f) => ({ path: f.Path, size: f.Size, modified: f.ModTime }));
    } else {
      if (!(await exists(root)) && request.direction === 'upload')
        throw new Error(
          `Local save directory does not exist: ${root}. Run PCSX2 or select your existing save folder in Settings.`,
        );
      local = (await exists(root)) ? (await walk(root)).map((f) => ({ ...f })) : [];
      remote = (await this.rclone.list(this.rclone.remote(request.kind))).map((f) => ({
        path: f.Path,
        size: f.Size,
        modified: f.ModTime,
      }));
    }
    return request.direction === 'upload'
      ? { source: local, destination: remote }
      : { source: remote, destination: local };
  }
  async plan(request: SyncRequest): Promise<SyncPlan> {
    const settings = JSON.stringify(this.store.value);
    if (this.busy || (request.kind !== 'Games' && this.pcsx2.running))
      throw new Error('Close PCSX2 and wait for active transfers before synchronizing.');
    await this.rclone.ensureFolders();
    const { source, destination } = await this.entries(request);
    if (settings !== JSON.stringify(this.store.value))
      throw new Error('Settings changed. Review a new transfer preview.');
    if (!source.length) throw new Error('No source files found. Nothing to transfer.');
    const id = randomUUID(),
      files = makeFiles(source, destination);
    const backupLocation =
      request.direction === 'upload'
        ? `${this.rclone.remote()}/Backups/${id}/${request.kind}`
        : path.join(this.store.userData, 'backups', id, request.kind);
    const plan: SyncPlan = {
      id,
      kind: request.kind,
      direction: request.direction,
      files,
      bytes: files.reduce((n, f) => n + f.size, 0),
      backupLocation,
    };
    for (const [key, value] of this.plans) if (value.expires < Date.now()) this.plans.delete(key);
    if (this.plans.size > 20) this.plans.clear();
    this.plans.set(id, {
      plan,
      request,
      fingerprint: fingerprint(source, destination),
      settings,
      expires: Date.now() + 10 * 60_000,
    });
    return plan;
  }
  cancel(id: string) {
    this.plans.delete(id);
  }
  detach(id: string, confirmed: boolean) {
    const prepared = this.plans.get(id);
    if (!prepared || prepared.expires < Date.now())
      throw new Error('Transfer preview expired. Review a new preview.');
    if (prepared.settings !== JSON.stringify(this.store.value))
      throw new Error('Settings changed. Review a new transfer preview.');
    if (prepared.plan.files.some((f) => f.replaces) && !confirmed)
      throw new Error('Confirm file replacements before proceeding.');
    this.plans.delete(id);
    return structuredClone(prepared);
  }
  adopt(prepared: Prepared) {
    this.plans.set(prepared.plan.id, {
      ...prepared,
      settings: JSON.stringify(this.store.value),
      expires: Infinity,
    });
  }
  async execute(id: string, confirmed: boolean) {
    const prepared = this.plans.get(id);
    if (!prepared || prepared.expires < Date.now())
      throw new Error('Transfer preview expired. Review a new preview.');
    if (this.busy || (prepared.request.kind !== 'Games' && this.pcsx2.running))
      throw new Error('Close PCSX2 and wait for active transfers first.');
    if (prepared.plan.files.some((f) => f.replaces) && !confirmed)
      throw new Error('Confirm file replacements before proceeding.');
    if (prepared.settings !== JSON.stringify(this.store.value))
      throw new Error('Settings changed. Review a new transfer preview.');
    this.busy = true;
    try {
      this.signal?.throwIfAborted();
      const { source, destination } = await this.entries(prepared.request);
      if (prepared.fingerprint !== fingerprint(source, destination))
        throw new Error('Files changed since preview. Review a new transfer preview before overwriting.');
      const { plan, request } = prepared;
      this.plans.delete(id);
      const root = this.localRoot(request);
      let completed = 0;
      for (let index = 0; index < source.length; index++) {
        this.signal?.throwIfAborted();
        const file = source[index];
        safeRelative(file.path);
        const remote = `${this.rclone.remote(request.kind)}/${file.path}`;
        const local = request.direction === 'upload' ? file.absolute! : within(root, file.path);
        await rejectSymlinks(local);
        if (request.direction === 'download') await fs.mkdir(path.dirname(local), { recursive: true });
        const from = request.direction === 'upload' ? local : remote;
        const to = request.direction === 'upload' ? remote : local;
        const subdir = path.posix.dirname(file.path);
        const backup =
          request.direction === 'upload'
            ? `${plan.backupLocation}/${subdir}`
            : path.join(plan.backupLocation, subdir);
        if (request.direction === 'download') {
          await rejectSymlinks(backup);
          await fs.mkdir(backup, { recursive: true });
        }
        this.emit({
          operation: 'sync',
          message: `${index + 1}/${source.length}: ${file.path}`,
          bytes: completed,
          totalBytes: plan.bytes,
          percent: plan.bytes ? (completed / plan.bytes) * 100 : undefined,
        });
        // copyto never propagates deletions. Rclone moves replaced destinations into backup-dir before writing.
        const copy = this.background
          ? (args: string[], progress: (p: Progress) => void) =>
              this.stagedCopy(args, progress, file, destination, request, plan, index)
          : (args: string[], progress: (p: Progress) => void) => this.rclone.call(args, progress);
        await copy(
          [
            'copyto',
            from,
            to,
            '--backup-dir',
            backup,
            '--ignore-times',
            '--retries',
            '3',
            '--low-level-retries',
            '5',
          ],
          (progress) => {
            const bytes = Math.min(plan.bytes, completed + (progress.bytes ?? 0));
            this.emit({
              ...progress,
              message: `${index + 1}/${source.length}: ${file.path}`,
              bytes,
              totalBytes: plan.bytes,
              percent: plan.bytes ? (bytes / plan.bytes) * 100 : undefined,
            });
          },
        );
        completed += file.size;
      }
      this.emit({
        operation: 'sync',
        message: 'Transfer complete. Existing files backed up before replacement.',
        percent: 100,
        bytes: plan.bytes,
        totalBytes: plan.bytes,
      });
    } finally {
      this.busy = false;
    }
  }
  private async stagedCopy(
    args: string[],
    progress: (p: Progress) => void,
    file: Entry,
    destination: Entry[],
    request: SyncRequest,
    plan: SyncPlan,
    index: number,
  ) {
    const from = args[1],
      to = args[2],
      backup = args[args.indexOf('--backup-dir') + 1];
    const download = request.direction === 'download';
    const stage = download
      ? path.join(path.dirname(to), `.${path.basename(to)}.${plan.id}.partial`)
      : `${this.rclone.remote(request.kind)}/.launcher-${plan.id}-${index}.partial`;
    const previous = destination.find((f) => f.path === file.path);
    let movedOriginal = false;
    try {
      await this.rclone.call(
        ['copyto', from, stage, '--ignore-times', '--inplace', '--retries', '3', '--low-level-retries', '5'],
        progress,
      );
      this.signal?.throwIfAborted();
      if (download) {
        await rejectSymlinks(to);
        if (request.kind !== 'Games' && this.pcsx2.running)
          throw new Error('Close PCSX2 before replacing saves.');
        if (
          request.kind === 'Games' &&
          this.pcsx2.running &&
          this.pcsx2.gamePath &&
          path.resolve(this.pcsx2.gamePath).toLowerCase() === path.resolve(to).toLowerCase()
        )
          throw new Error('Close this game before replacing its disc image.');
        const current = (await exists(to)) ? await fs.stat(to) : undefined;
        if (
          !!previous !== !!current ||
          (previous &&
            current &&
            (previous.size !== current.size || previous.modified !== current.mtime.toISOString()))
        )
          throw new Error('Destination changed during transfer. Original file kept.');
        if (current) {
          await fs.mkdir(backup, { recursive: true });
          await fs.copyFile(to, path.join(backup, path.basename(to)), 1);
        }
        this.signal?.throwIfAborted();
        await fs.rename(stage, to);
      } else {
        const current = (await this.rclone.list(this.rclone.remote(request.kind))).find(
          (f) => f.Path === file.path,
        );
        if (
          !!previous !== !!current ||
          (previous && current && (previous.size !== current.Size || previous.modified !== current.ModTime))
        )
          throw new Error('Cloud destination changed during transfer. Original file kept.');
        this.signal?.throwIfAborted();
        if (previous) {
          await this.rclone.commit(['moveto', to, `${backup}/${path.posix.basename(file.path)}`]);
          movedOriginal = true;
        }
        try {
          await this.rclone.commit(['moveto', stage, to]);
        } catch (error) {
          if (movedOriginal)
            await this.rclone.commit(['moveto', `${backup}/${path.posix.basename(file.path)}`, to]);
          throw error;
        }
      }
    } finally {
      // Staging is unique to this plan; cancellation never removes an existing destination.
      if (download) await fs.rm(stage, { force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
      else await this.rclone.commit(['deletefile', stage]).catch(() => {});
    }
  }
}
