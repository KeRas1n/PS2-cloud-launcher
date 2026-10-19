import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle, X } from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { PageHeading } from '../../components/PageHeading';
import { size, transferRate } from '../../lib/format';
import { activeTransfer } from './transfer-state';
export function DownloadsPage() {
  const { transfers, cancelTransfer } = useLauncher();

  return (
    <>
      <PageHeading title="Downloads" />
      <p className="downloads-description">
        Two transfers run at a time. Games stay playable while files transfer. Closing the launcher cancels
        pending transfers.
      </p>
      {!transfers.length && (
        <section className="panel empty-transfers">
          <ArrowDownToLine size={30} />
          <h3>No transfers yet</h3>
          <p>Game downloads and uploads appear here.</p>
        </section>
      )}
      <div className="transfer-list">
        {[
          ...transfers.filter(activeTransfer),
          ...transfers.filter((item) => !activeTransfer(item)).reverse(),
        ].map((item) => (
          <article
            className={`panel transfer-row state-${item.state}`}
            key={item.id}
            aria-label={`${item.direction} ${item.title}`}
          >
            <div className="transfer-direction">
              {item.direction === 'download' ? <ArrowDownToLine size={22} /> : <ArrowUpFromLine size={22} />}
            </div>
            <div className="transfer-info">
              <div className="transfer-title">
                <h3>{item.title}</h3>
                <span>MEGA · {item.direction === 'download' ? 'Download' : 'Upload'}</span>
              </div>
              <div className="progress-track">
                <div
                  style={{
                    width: `${item.totalBytes ? Math.min(100, (item.bytes / item.totalBytes) * 100) : item.state === 'completed' ? 100 : 0}%`,
                  }}
                />
              </div>
              <div className="transfer-metrics">
                <span>
                  {item.state === 'running'
                    ? transferRate(item.speed)
                    : item.state === 'queued'
                      ? 'Queued'
                      : item.state === 'cancelling'
                        ? 'Cancelling…'
                        : item.state === 'completed'
                          ? 'Complete'
                          : item.state === 'cancelled'
                            ? 'Cancelled'
                            : 'Failed'}
                </span>
                <span>
                  {size(item.bytes)} / {size(item.totalBytes)}
                </span>
              </div>
              <p className="transfer-message">{item.error ?? item.message}</p>
            </div>
            {activeTransfer(item) && (
              <button
                className="icon-button cancel-transfer"
                aria-label={`Cancel ${item.direction} ${item.title}`}
                title="Cancel transfer"
                disabled={item.state === 'cancelling'}
                onClick={() => void cancelTransfer(item.id)}
              >
                {item.state === 'cancelling' ? <LoaderCircle className="spin" size={19} /> : <X size={20} />}
              </button>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
