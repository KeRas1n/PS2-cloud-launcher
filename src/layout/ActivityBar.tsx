import { CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { useLauncher } from '../app/useLauncher';
import { size, transferRate } from '../lib/format';
export function ActivityBar() {
  const { busy, progress, saveSyncRunning, setProgress } = useLauncher();

  return (
    (busy || progress) && (
      <div className="operation-bar" role="status">
        <div className="operation-symbol">
          {busy || saveSyncRunning ? <LoaderCircle size={19} className="spin" /> : <CheckCircle2 size={19} />}
        </div>
        <div className="operation-detail">
          <strong>{busy || (saveSyncRunning ? 'Synchronizing saves' : 'Activity')}</strong>
          <span>{progress?.message ?? 'Please wait…'}</span>
          {progress?.percent !== undefined && (
            <div className="progress-track">
              <div style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }} />
            </div>
          )}
        </div>
        <small>
          {progress?.bytes !== undefined
            ? `${size(progress.bytes)}${progress.totalBytes ? ` / ${size(progress.totalBytes)}` : ''}`
            : ''}
          {progress?.speed !== undefined ? ` · ${transferRate(progress.speed)}` : ''}
        </small>
        {!busy && (
          <button
            className="icon-button"
            aria-label="Dismiss activity"
            onClick={() => setProgress(undefined)}
          >
            <X size={16} />
          </button>
        )}
      </div>
    )
  );
}
