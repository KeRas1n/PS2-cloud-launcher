import path from 'node:path';
import { z } from 'zod';
import type { IpcContext } from './types';
export function registerGamesHandlers({ runtime, handle, pick }: IpcContext) {
  const { pcsx2, games, transfers, exclusive } = runtime;
  const id = z.string().regex(/^[a-f0-9]{64}$/);
  handle('games:list', () => games.scan());
  const guardDeletion = (gameId: string) => {
    const game = games.get(gameId);
    if (game.localPath && transfers.has(`local:${path.resolve(game.localPath).toLowerCase()}`))
      throw new Error('Cancel this game transfer before deleting its local file.');
    if (
      game.localPath &&
      pcsx2.running &&
      pcsx2.gamePath &&
      path.resolve(game.localPath).toLowerCase() === path.resolve(pcsx2.gamePath).toLowerCase()
    )
      throw new Error('Close this game before deleting its local file.');
  };
  handle('games:delete-preview', async (gameId) => {
    const parsed = id.parse(gameId);
    guardDeletion(parsed);
    return games.prepareDelete(parsed);
  });
  handle('games:delete', (token, confirmed) =>
    exclusive(async () => {
      const parsed = z.string().uuid().parse(token);
      guardDeletion(games.deletionGame(parsed).id);
      await games.deleteLocal(parsed, z.boolean().parse(confirmed));
    }),
  );
  handle('games:cover', (gameId) =>
    exclusive(async () => {
      const game = games.get(id.parse(gameId));
      const file = await pick('cover');
      if (file) await games.setCover(game.id, file);
    }),
  );
}
