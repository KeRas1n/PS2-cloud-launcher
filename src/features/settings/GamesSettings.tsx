import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { supportedGameFormats } from '../../../shared/game-formats';
import { useLauncher } from '../../app/useLauncher';
import { Button } from '../../components/Button';
import { SettingsPathField } from './SettingsPathField';
export function GamesSettings() {
  const { draft, disabled, update, addDirectory, setError } = useLauncher();

  return (
    <section
      className="panel settings-panel"
      role="tabpanel"
      id="settings-panel-Games"
      aria-labelledby="settings-tab-Games"
      tabIndex={0}
    >
      <div className="settings-section-title">
        <FolderOpen size={20} />
        <div>
          <h3>Game library</h3>
          <p>
            Scan folders recursively for {supportedGameFormats}. For CUE/BIN, include the BIN image. Filename
            identifies each cloud game.
          </p>
        </div>
      </div>
      <div className="directory-list">
        {draft?.gameDirectories.map((directory) => (
          <div key={directory}>
            <FolderOpen size={17} />
            <code>{directory}</code>
            <button
              className="icon-button"
              aria-label={`Remove ${directory}`}
              disabled={disabled}
              onClick={() =>
                update(
                  'gameDirectories',
                  draft.gameDirectories.filter((p) => p !== directory),
                )
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <Button
        secondary
        disabled={disabled}
        onClick={() => void addDirectory().catch((e) => setError(e.message))}
      >
        <Plus size={16} /> Add game directory
      </Button>
      <SettingsPathField
        label={'Game download directory'}
        setting={'downloadDirectory'}
        help={'Cloud downloads are saved here. This folder is scanned automatically.'}
        kind={'directory'}
      />
    </section>
  );
}
