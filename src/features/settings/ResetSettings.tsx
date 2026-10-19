import { useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { api } from '../../lib/launcher-api';

export function ResetSettings() {
  const { disabled, emulator, activeTransfers } = useLauncher();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const blocked = disabled || !!emulator?.running || !!activeTransfers.length;

  async function reset() {
    if (!api || resetting) return;
    setResetting(true);
    setError('');
    try {
      await api.resetLauncher(true);
      window.location.reload();
    } catch (error) {
      setError((error as Error).message);
      setResetting(false);
    }
  }

  return (
    <section
      className="panel settings-panel"
      role="tabpanel"
      id="settings-panel-Data"
      aria-labelledby="settings-tab-Data"
      tabIndex={0}
    >
      <div className="settings-section-title">
        <Trash2 size={20} />
        <div>
          <h3>Delete launcher data</h3>
          <p>
            Disconnect cloud accounts and reset launcher preferences, covers, logs, cached data and
            synchronization history.
          </p>
        </div>
      </div>
      <p>
        Games, BIOS, memory cards, save states, backups, PCSX2 and its settings stay on disk. All custom file
        and folder paths are cleared. The launcher returns to its own default folders.
      </p>
      <p>
        Cloud files and custom external Rclone configurations are kept. You will need to connect your cloud
        account again.
      </p>
      <p>
        Close PCSX2 and finish or cancel all transfers before continuing. The launcher reloads after the
        reset.
      </p>
      <Button
        className="danger"
        disabled={blocked || resetting}
        onClick={() => {
          setError('');
          setConfirming(true);
        }}
      >
        <Trash2 size={16} /> Delete launcher data
      </Button>
      {confirming && (
        <Dialog labelledBy="reset-launcher-title" blocked={resetting} onClose={() => setConfirming(false)}>
          <h2 id="reset-launcher-title">Delete all launcher data?</h2>
          <p>
            This permanently removes saved cloud connections, launcher preferences, covers, logs and
            synchronization history, including all custom file and folder paths. Unsaved preference changes
            are discarded.
          </p>
          <p>
            Games, BIOS, saves, backups and PCSX2 files and settings remain on this device. Nothing is deleted
            from your cloud.
          </p>
          {error && (
            <p role="alert" className="conflict-warning">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button secondary disabled={resetting} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button className="danger" disabled={resetting || blocked} onClick={() => void reset()}>
              {resetting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
              {resetting ? 'Deleting launcher data…' : 'Delete data and reload'}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
