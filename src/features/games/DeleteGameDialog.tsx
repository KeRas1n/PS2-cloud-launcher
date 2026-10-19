import { LoaderCircle, Trash2, X } from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
export function DeleteGameDialog() {
  const { busy, deletion, deleting, setDeletion, deletionError, confirmDelete } = useLauncher();

  return (
    deletion && (
      <Dialog
        labelledBy="delete-game-title"
        describedBy="delete-game-warning"
        className="modal delete-game-modal"
        blocked={!!busy || deleting}
        onClose={() => setDeletion(undefined)}
      >
        <div className="modal-top">
          <div className="panel-symbol delete-symbol">
            <Trash2 />
          </div>
          <button
            className="icon-button"
            aria-label="Close delete confirmation"
            disabled={deleting}
            onClick={() => setDeletion(undefined)}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="delete-game-title">Are you sure you want to delete this game?</h2>
        <p className="delete-game-name">{deletion.title}</p>
        <p className="delete-game-path">{deletion.localPath}</p>
        <p
          id="delete-game-warning"
          className={deletion.cloud === 'stored' ? 'safe-note' : 'conflict-warning'}
        >
          {deletion.cloud === 'stored'
            ? 'This game is backed up in the cloud. You can download it again anytime.'
            : deletion.cloud === 'missing'
              ? 'This game is not backed up in the cloud. Deleting it will permanently remove your local copy!'
              : 'Unable to verify whether this game is backed up in the cloud. You may permanently lose it if no backup exists!'}
        </p>
        {deletionError && (
          <p role="alert" className="delete-game-error">
            {deletionError}
          </p>
        )}
        <div className="modal-actions">
          <Button secondary disabled={deleting} onClick={() => setDeletion(undefined)}>
            Cancel
          </Button>
          <Button className="danger" disabled={deleting} onClick={() => void confirmDelete()}>
            {deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{' '}
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Dialog>
    )
  );
}
