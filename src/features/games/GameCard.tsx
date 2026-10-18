import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Cloud,
  Disc3,
  HardDrive,
  ImagePlus,
  MoreHorizontal,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { gameExtension } from '../../../shared/game-formats';
import type { Game, Transfer } from '../../../shared/types';

import { size } from '../../lib/format';
export function GameCard({
  game,
  index,
  disabled,
  connected,
  cloudChecked,
  onPlay,
  onTransfer,
  onCover,
  transfer,
  onCancel,
  emulatorRunning,
  preparing,
  onDelete,
  deletionLoading,
}: {
  game: Game;
  index: number;
  disabled: boolean;
  connected: boolean;
  cloudChecked: boolean;
  onPlay: () => void;
  onTransfer: (direction: 'upload' | 'download') => void;
  onCover: () => void;
  transfer?: Transfer;
  onCancel: (id: string) => void;
  emulatorRunning: boolean;
  preparing: boolean;
  onDelete: () => void;
  deletionLoading: boolean;
}) {
  const download = game.state === 'Cloud Only';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        menuButton.current?.focus();
      } else if (event.key === 'Tab') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);
  return (
    <article className="game-card" style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
      <div className={`game-cover cover-color-${index % 6}`}>
        {game.cover ? (
          <img src={game.cover} alt={`${game.title} cover`} />
        ) : (
          <div className="generated-cover">
            <div className="cover-console">PLAYSTATION 2</div>
            <Disc3 size={56} />
            <strong>{game.title}</strong>
          </div>
        )}
        <div className="cover-overlay">
          <button
            className="cover-edit"
            title="Import cover art"
            aria-label={`Import cover for ${game.title}`}
            disabled={disabled}
            onClick={onCover}
          >
            <ImagePlus size={18} />
          </button>
          <button
            className="cover-play"
            disabled={disabled || (download ? !!transfer || preparing || !connected : emulatorRunning)}
            aria-label={download ? `Download ${game.title}` : `Play ${game.title}`}
            onClick={download ? () => onTransfer('download') : onPlay}
          >
            {download ? <ArrowDownToLine size={25} /> : <Play size={27} fill="currentColor" />}
          </button>
        </div>
        <span className="cover-format">{gameExtension(game.name)?.toUpperCase()}</span>
      </div>
      <div className="game-info">
        <div className="game-title-row">
          <h3 title={game.title}>{game.title}</h3>
          <div className="game-menu" ref={menuRef}>
            <button
              ref={menuButton}
              className="icon-button game-menu-toggle"
              aria-label={`Меню игры ${game.title}`}
              title="Дополнительные действия"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={`game-menu-${game.id}`}
              disabled={disabled}
              onClick={() => setMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setMenuOpen(true);
                }
              }}
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div
                id={`game-menu-${game.id}`}
                role="menu"
                aria-label={`Действия с игрой ${game.title}`}
                className="game-menu-popup"
              >
                <button
                  role="menuitem"
                  disabled={!game.localPath || !!transfer || deletionLoading}
                  title={
                    !game.localPath
                      ? 'На устройстве нет файла этой игры'
                      : transfer
                        ? 'Сначала отмените передачу этой игры'
                        : undefined
                  }
                  onClick={() => {
                    setMenuOpen(false);
                    menuButton.current?.focus();
                    onDelete();
                  }}
                >
                  <Trash2 size={15} /> Удалить игру
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="game-meta">
          <span className={game.state === 'In Cloud' ? 'synced' : ''}>
            {game.cloudPath ? <Cloud size={12} /> : <HardDrive size={12} />}{' '}
            {cloudChecked || game.cloudPath ? game.state : 'Cloud unchecked'}
          </span>
          <span>{size(game.size)}</span>
        </div>
        <div className="game-actions">
          <button
            className={download ? 'download-game' : 'play-game'}
            disabled={disabled || (download ? !connected || !!transfer || preparing : emulatorRunning)}
            onClick={download ? () => onTransfer('download') : onPlay}
          >
            {download ? <ArrowDownToLine size={14} /> : <Play size={14} fill="currentColor" />}
            {download ? 'Download' : 'Play'}
          </button>
          {game.state === 'Local Only' && (
            <button
              className="upload-game"
              title="Upload to Cloud"
              disabled={disabled || !connected || !!transfer || preparing}
              onClick={() => onTransfer('upload')}
            >
              <ArrowUpFromLine size={14} />
              <span>Upload to Cloud</span>
            </button>
          )}
          {game.state === 'In Cloud' && (
            <span className="cloud-check" title="Available locally and in cloud storage">
              <CheckCircle2 size={16} />
            </span>
          )}
        </div>
        {transfer && (
          <div className="game-transfer">
            <span>
              {transfer.state === 'queued'
                ? 'Queued'
                : transfer.state === 'cancelling'
                  ? 'Cancelling…'
                  : `${transfer.direction === 'upload' ? 'Uploading' : 'Downloading'} ${transfer.totalBytes ? Math.round((transfer.bytes / transfer.totalBytes) * 100) : 0}%`}
            </span>
            <button
              className="icon-button"
              aria-label={`Cancel transfer for ${game.title}`}
              disabled={transfer.state === 'cancelling'}
              onClick={() => onCancel(transfer.id)}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
