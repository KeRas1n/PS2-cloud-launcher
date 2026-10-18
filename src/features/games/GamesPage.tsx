import {
  ArrowRight,
  Cloud,
  Disc3,
  FolderOpen,
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { supportedGameFormats } from '../../../shared/game-formats';
import { useLauncher } from '../../app/useLauncher';
import { Button } from '../../components/Button';
import { size } from '../../lib/format';
import { api } from '../../lib/launcher-api';
import { GameCard } from './GameCard';
export function GamesPage() {
  const {
    localCount,
    cloudCount,
    library,
    games,
    filter,
    goToSettings,
    disabled,
    act,
    busy,
    setFilter,
    query,
    setQuery,
    compact,
    setCompact,
    connected,
    emulator,
    activeTransfers,
    preparingTransfer,
    deletionLoading,
    beginDelete,
    cancelTransfer,
    preview,
    providerName,
    setPage,
  } = useLauncher();

  return (
    <>
      <div className="library-stats">
        <span>
          <HardDrive size={16} />
          <strong>{localCount}</strong> installed
        </span>
        <span>
          <Cloud size={16} />
          <strong>{cloudCount}</strong> in cloud
        </span>
        <span>
          <Disc3 size={16} />
          <strong>
            {size(library.games.filter((g) => g.localPath).reduce((n, g) => n + g.size, 0))}
          </strong>{' '}
          local library
        </span>
      </div>
      <div className="section-heading">
        <div>
          <h2>
            Game library <span>{library.games.length}</span>
          </h2>
        </div>
        <div className="button-row">
          <Button secondary onClick={() => goToSettings('Games')}>
            <Plus size={16} /> Add game folder
          </Button>
          <Button
            secondary
            disabled={disabled}
            onClick={() => void act('Refreshing library', async () => {}, undefined)}
          >
            <RefreshCw size={15} className={busy === 'Refreshing library' ? 'spin' : ''} /> Refresh library
          </Button>
        </div>
      </div>
      <div className="library-toolbar">
        <div className="tabs">
          {['All games', 'Installed', 'Cloud only'].map((tab) => (
            <button key={tab} className={filter === tab ? 'selected' : ''} onClick={() => setFilter(tab)}>
              {tab}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="search">
            <Search size={16} />
            <input
              placeholder="Search games"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search games"
            />
          </label>
          <button
            className={`icon-button view-toggle ${compact ? 'selected' : ''}`}
            title="Toggle compact grid"
            aria-label="Toggle compact grid"
            aria-pressed={compact}
            onClick={() => setCompact(!compact)}
          >
            <SlidersHorizontal size={17} />
          </button>
        </div>
      </div>
      {!!library.warnings.length && (
        <details className="warnings">
          <summary>
            {library.warnings.length} library notice{library.warnings.length !== 1 ? 's' : ''}
            {!library.cloudChecked ? ' · Cloud status not verified' : ''}
          </summary>
          {library.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </details>
      )}
      {games.length ? (
        <div className={`game-grid ${compact ? 'compact' : ''}`}>
          {games.map((game, index) => (
            <GameCard
              key={game.id}
              game={game}
              index={index}
              cloudChecked={library.cloudChecked}
              disabled={disabled}
              connected={connected}
              emulatorRunning={!!emulator?.running}
              transfer={activeTransfers.find((item) => item.gameId === game.id)}
              preparing={preparingTransfer}
              deletionLoading={deletionLoading}
              onDelete={() => void beginDelete(game)}
              onCancel={(id) => void cancelTransfer(id)}
              onPlay={() =>
                void act('Starting PCSX2', () => api!.openEmulator(game.id), 'PCSX2 launched', false)
              }
              onTransfer={(direction) => void preview({ kind: 'Games', direction, gameId: game.id })}
              onCover={() => void act('Importing cover', () => api!.setCover(game.id))}
            />
          ))}
        </div>
      ) : (
        <div className="empty-library">
          <h3>{query || filter !== 'All games' ? 'No matching games' : 'No games found'}</h3>
          <p>
            {query || filter !== 'All games'
              ? 'Try another search or library filter.'
              : `Add a folder with PCSX2 images (${supportedGameFormats}), or connect ${providerName} to discover your cloud library. For CUE/BIN, include the BIN image.`}
          </p>
          {!query && filter === 'All games' && (
            <div className="empty-actions">
              <Button secondary onClick={() => goToSettings('Games')}>
                <FolderOpen size={16} /> Choose game folders
              </Button>
              <button className="text-button" onClick={() => setPage('Cloud')}>
                Connect {providerName} <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
