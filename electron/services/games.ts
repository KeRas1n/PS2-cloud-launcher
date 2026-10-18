import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Game, GameDeletion, Library } from '../../shared/types';
import { SettingsStore } from './settings';
import { RcloneService } from './rclone';
import { walk, exists } from './files';
import { isGame, gameTitle } from '../../shared/game-formats';

export { isGame } from '../../shared/game-formats';
export const gameKey = (name: string) => name.normalize('NFC').toLowerCase();
export class GameService {
  clear() {
    this.games.clear();
    this.deletions.clear();
  }
  games = new Map<string, Game>();
  private deletions = new Map<
    string,
    { preview: GameDeletion; fingerprint: string; settings: string; expires: number }
  >();
  constructor(
    private store: SettingsStore,
    private rclone: RcloneService,
  ) {}
  async scan(): Promise<Library> {
    const warnings: string[] = [];
    const games = new Map<string, Game>();
    const roots = [...new Set([...this.store.value.gameDirectories, this.store.value.downloadDirectory])];
    for (const root of roots) {
      if (root === this.store.value.downloadDirectory && !(await exists(root))) continue;
      try {
        const files = await walk(root);
        const images = new Set(
          files.filter((file) => isGame(file.path)).map((file) => path.resolve(file.absolute).toLowerCase()),
        );
        for (const file of files) {
          if (/\.cue$/i.test(file.path)) {
            // Inspect only small descriptors. Never follow their paths outside the scanned file set.
            const cue = file.size <= 1024 * 1024 ? await fs.readFile(file.absolute, 'utf8') : '';
            const referenced = [...cue.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+\S+/gim)].map(
              (match) => match[1] ?? match[2],
            );
            if (
              !referenced.length ||
              referenced.some(
                (name) =>
                  !images.has(
                    path.resolve(path.dirname(file.absolute), name.replace(/\\/g, '/')).toLowerCase(),
                  ),
              )
            )
              warnings.push(
                `CUE descriptor ${file.path}: PCSX2 opens the associated BIN image, not CUE. Add the referenced image files to this game folder; CUE alone cannot run a game.`,
              );
          }
          if (!isGame(file.path)) continue;
          const name = path.basename(file.path),
            key = gameKey(name);
          if (games.has(key)) {
            if (games.get(key)?.localPath !== file.absolute)
              warnings.push(
                `Duplicate filename: ${name}. Cloud matching uses filenames; rename different discs before uploading.`,
              );
            continue;
          }
          const id = createHash('sha256').update(key).digest('hex');
          games.set(key, {
            id,
            name,
            title: gameTitle(name),
            size: file.size,
            localPath: file.absolute,
            state: 'Local Only',
          });
        }
      } catch (error) {
        warnings.push(`Cannot scan ${root}: ${(error as Error).message}`);
      }
    }
    let cloudChecked = false;
    const status = await this.rclone.status();
    if (status.connected) {
      try {
        await this.rclone.ensureFolders();
        const files = await this.rclone.list(this.rclone.remote('Games'));
        if (
          files.some((file) => /\.cue$/i.test(file.Path)) &&
          !files.some((file) => /\.bin$/i.test(file.Path))
        )
          warnings.push(
            'Cloud contains CUE descriptors without BIN images. Upload the associated BIN files: PCSX2 cannot play CUE alone.',
          );
        for (const file of files) {
          if (!isGame(file.Path)) continue;
          const name = file.Path.split('/').pop()!,
            key = gameKey(name);
          const local = games.get(key);
          if (local?.cloudPath) {
            warnings.push(`Duplicate cloud filename: ${name}. Only the first copy is shown.`);
            continue;
          }
          if (local) {
            local.cloudPath = file.Path;
            local.state = 'In Cloud';
          } else
            games.set(key, {
              id: createHash('sha256').update(key).digest('hex'),
              name,
              title: gameTitle(name),
              size: file.Size,
              cloudPath: file.Path,
              state: 'Cloud Only',
            });
        }
        cloudChecked = true;
      } catch (error) {
        warnings.push(`Cloud library unavailable: ${(error as Error).message}`);
      }
    } else if (status.error) warnings.push(status.error);
    this.games = new Map([...games.values()].map((g) => [g.id, g]));
    for (const game of this.games.values()) {
      const cover = path.join(this.store.userData, 'covers', `${game.id}.img`);
      if (await exists(cover))
        game.cover = `launcher-cover://cover/${game.id}?v=${(await fs.stat(cover)).mtimeMs}`;
    }
    return {
      games: [...this.games.values()].sort((a, b) => a.title.localeCompare(b.title)),
      warnings,
      cloudChecked,
    };
  }
  get(id: string) {
    const game = this.games.get(id);
    if (!game) throw new Error('Game no longer exists. Refresh the library.');
    return game;
  }
  private async localFingerprint(file: string) {
    const inside = (root: string, target: string) => {
      const relative = path.relative(path.resolve(root), path.resolve(target));
      return (
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      );
    };
    const roots = [...this.store.value.gameDirectories, this.store.value.downloadDirectory];
    const real = await fs.realpath(file);
    let allowed = false;
    for (const root of roots) {
      if (inside(root, file) && inside(await fs.realpath(root), real)) {
        allowed = true;
        break;
      }
    }
    if (!allowed || !isGame(file))
      throw new Error('Game is outside the selected library folders. Refresh the library.');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Only a regular local game file can be deleted.');
    return JSON.stringify([real, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
  }
  private async cloudCopy(game: Game): Promise<GameDeletion['cloud']> {
    try {
      const status = await this.rclone.status();
      if (!status.connected)
        return status.installed && !status.error && !status.remotes.includes(this.store.value.remote)
          ? 'missing'
          : 'unknown';
      const files = await this.rclone.list(this.rclone.remote('Games'));
      const name = (game.cloudPath ?? game.name).toLowerCase();
      return files.some((file) => file.Path.toLowerCase() === name) ? 'stored' : 'missing';
    } catch {
      return 'unknown';
    }
  }
  async prepareDelete(id: string): Promise<GameDeletion> {
    const game = structuredClone(this.get(id));
    if (!game.localPath) throw new Error('This game has no local file to delete.');
    const settings = JSON.stringify(this.store.value);
    const fingerprint = await this.localFingerprint(game.localPath);
    const preview: GameDeletion = {
      token: randomUUID(),
      gameId: id,
      title: game.title,
      localPath: game.localPath,
      cloud: await this.cloudCopy(game),
    };
    if (settings !== JSON.stringify(this.store.value))
      throw new Error('Settings changed. Open the delete dialog again.');
    for (const [key, item] of this.deletions) if (item.expires < Date.now()) this.deletions.delete(key);
    if (this.deletions.size >= 20) this.deletions.delete(this.deletions.keys().next().value!);
    this.deletions.set(preview.token, { preview, fingerprint, settings, expires: Date.now() + 5 * 60_000 });
    return preview;
  }
  deletionGame(token: string) {
    const item = this.deletions.get(token);
    if (!item || item.expires < Date.now())
      throw new Error('Delete confirmation expired. Open the dialog again.');
    return this.get(item.preview.gameId);
  }
  async deleteLocal(token: string, confirmed: boolean) {
    if (!confirmed) throw new Error('Confirm game deletion first.');
    const game = this.deletionGame(token);
    const item = this.deletions.get(token)!;
    if (item.settings !== JSON.stringify(this.store.value) || game.localPath !== item.preview.localPath)
      throw new Error('Settings or game changed. Open the delete dialog again.');
    if ((await this.cloudCopy(game)) !== item.preview.cloud)
      throw new Error('Cloud status changed. Open the delete dialog again.');
    if ((await this.localFingerprint(item.preview.localPath)) !== item.fingerprint)
      throw new Error('Game file changed. Open the delete dialog again.');
    this.deletions.delete(token);
    await fs.unlink(item.preview.localPath);
    if (item.preview.cloud === 'stored') {
      game.localPath = undefined;
      game.state = 'Cloud Only';
    } else this.games.delete(game.id);
  }
  async setCover(id: string, file: string) {
    this.get(id);
    const stat = await fs.stat(file);
    if (stat.size > 20 * 1024 * 1024) throw new Error('Cover image must be smaller than 20 MB.');
    await fs.mkdir(path.join(this.store.userData, 'covers'), { recursive: true });
    await fs.copyFile(file, path.join(this.store.userData, 'covers', `${id}.img`));
  }
}
