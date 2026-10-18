import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Game, Library } from '../../shared/types';
import { SettingsStore } from './settings';
import { RcloneService } from './rclone';
import { walk, exists } from './files';

export const isGame = (name: string) => /\.(iso|chd)$/i.test(name);
export const gameKey = (name: string) => name.normalize('NFC').toLowerCase();
export class GameService {
  games = new Map<string, Game>();
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
        for (const file of await walk(root)) {
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
            title: name.replace(/\.(iso|chd)$/i, '').replace(/[_]/g, ' '),
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
        for (const file of await this.rclone.list(this.rclone.remote('Games'))) {
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
              title: name.replace(/\.(iso|chd)$/i, '').replace(/_/g, ' '),
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
      if (await exists(cover)) game.cover = `launcher-cover://cover/${game.id}`;
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
  async setCover(id: string, file: string) {
    this.get(id);
    const stat = await fs.stat(file);
    if (stat.size > 20 * 1024 * 1024) throw new Error('Cover image must be smaller than 20 MB.');
    await fs.mkdir(path.join(this.store.userData, 'covers'), { recursive: true });
    await fs.copyFile(file, path.join(this.store.userData, 'covers', `${id}.img`));
  }
}
