import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import type { Game, GameDeletion, Library } from '../../../shared/types';
import { api } from '../../lib/launcher-api';
export function useGameDeletion(
  setLibrary: Dispatch<SetStateAction<Library>>,
  setError: Dispatch<SetStateAction<string>>,
  setNotice: Dispatch<SetStateAction<string>>,
) {
  const [deletion, setDeletion] = useState<GameDeletion>();
  const [deleting, setDeleting] = useState(false);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [deletionError, setDeletionError] = useState('');
  async function beginDelete(game: Game) {
    if (!api || deletionLoading) return;
    setDeletionLoading(true);
    setDeletionError('');
    try {
      setDeletion(await api.prepareDeleteGame(game.id));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setDeletionLoading(false);
    }
  }
  async function confirmDelete() {
    if (!api || !deletion || deleting) return;
    setDeleting(true);
    setDeletionError('');
    try {
      await api.deleteGame(deletion.token, true);
      setDeletion(undefined);
      setNotice('Игра удалена с устройства');
      setLibrary(await api.library());
    } catch (error) {
      setDeletionError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return {
    deletion,
    setDeletion,
    deleting,
    deletionLoading,
    deletionError,
    beginDelete,
    confirmDelete,
  };
}
