import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { size } from '../../lib/format';
export function SyncPreviewDialog() {
  const { plan, busy, cancelPreview, providerName, enqueuePlan } = useLauncher();

  return (
    plan && (
      <Dialog labelledBy="transfer-title" blocked={!!busy} onClose={() => void cancelPreview()}>
        <div className="modal-top">
          <div className="panel-symbol">
            <ShieldCheck />
          </div>
          <button
            className="icon-button"
            aria-label="Cancel transfer"
            disabled={!!busy}
            onClick={() => void cancelPreview()}
          >
            <X size={20} />
          </button>
        </div>
        <div className="eyebrow muted">REVIEW TRANSFER</div>
        <h2 id="transfer-title">
          {plan.direction === 'upload' ? `Upload to ${providerName}` : 'Download to this device'}
        </h2>
        <p>
          {plan.files.length} file{plan.files.length !== 1 ? 's' : ''} · {size(plan.bytes)} · {plan.kind}
        </p>
        {plan.files.some((f) => f.replaces) ? (
          <div className="conflict-warning">
            Files marked “Replace” will overwrite existing {plan.direction === 'upload' ? 'cloud' : 'local'}{' '}
            files. A backup is created before each replacement.
          </div>
        ) : (
          <div className="safe-note">
            <CheckCircle2 size={17} /> No existing files will be replaced.
          </div>
        )}
        <div className="transfer-files">
          {plan.files.map((file) => (
            <div key={file.path}>
              <div>
                <strong>{file.path}</strong>
                <small>
                  {size(file.size)}
                  {file.replaces && ` · Existing: ${size(file.previousSize ?? 0)}`}
                </small>
              </div>
              <span className={file.replaces ? 'replace-tag' : 'new-tag'}>
                {file.replaces ? 'Replace' : 'New'}
              </span>
            </div>
          ))}
        </div>
        <div className="backup-note">
          <ShieldCheck size={17} />
          <div>
            Backup location<code>{plan.backupLocation}</code>
          </div>
        </div>
        <p className="modal-help">
          No files are deleted because they are missing from the source.{' '}
          {plan.kind === 'Games'
            ? 'This transfer runs in the background. Installed games stay playable.'
            : 'Keep PCSX2 closed while save files are being synchronized.'}
        </p>
        <div className="modal-actions">
          <Button secondary disabled={!!busy} onClick={() => void cancelPreview()}>
            Cancel
          </Button>
          <Button
            disabled={!!busy}
            onClick={() => {
              void enqueuePlan(plan);
            }}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : plan.direction === 'upload' ? (
              <ArrowUpFromLine size={16} />
            ) : (
              <ArrowDownToLine size={16} />
            )}{' '}
            Confirm {plan.direction}
          </Button>
        </div>
      </Dialog>
    )
  );
}
