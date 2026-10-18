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
            aria-label="Закрыть подтверждение удаления"
            disabled={deleting}
            onClick={() => setDeletion(undefined)}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="delete-game-title">Вы уверены, что хотите удалить игру?</h2>
        <p className="delete-game-name">{deletion.title}</p>
        <p className="delete-game-path">{deletion.localPath}</p>
        <p
          id="delete-game-warning"
          className={deletion.cloud === 'stored' ? 'safe-note' : 'conflict-warning'}
        >
          {deletion.cloud === 'stored'
            ? 'Игра находится в вашем облаке, так что вы в любой момент сможете её оттуда скачать.'
            : deletion.cloud === 'missing'
              ? 'Эта игра не сохранена в вашем облаке! Вы её потеряете навсегда!'
              : 'Не удалось проверить копию игры в облаке. Если её там нет, после удаления вы потеряете игру навсегда!'}
        </p>
        {deletionError && (
          <p role="alert" className="delete-game-error">
            {deletionError}
          </p>
        )}
        <div className="modal-actions">
          <Button secondary disabled={deleting} onClick={() => setDeletion(undefined)}>
            Отменить
          </Button>
          <Button className="danger" disabled={deleting} onClick={() => void confirmDelete()}>
            {deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{' '}
            {deleting ? 'Удаление…' : 'Удалить'}
          </Button>
        </div>
      </Dialog>
    )
  );
}
