import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Layers3,
  RefreshCw,
} from 'lucide-react';
import { useLauncher } from '../../app/useLauncher';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeading } from '../../components/PageHeading';
import { api } from '../../lib/launcher-api';
import { MegaConnectionForm } from './MegaConnectionForm';
import { useCloudConnection } from './useCloudConnection';
export function CloudPage() {
  const {
    provider,
    disabled,
    emulator,
    providerName,
    connected,
    act,
    snapshot,
    preview,
    goToSettings,
    setError,
  } = useLauncher();
  const connection = useCloudConnection();
  const { changeMegaAccount, setChangeMegaAccount } = connection;

  return (
    <>
      <PageHeading title="Cloud" />
      <section className="panel provider-panel">
        <div className="provider-copy">
          <div className="row">
            <h2>{providerName}</h2>
            <Badge good={connected}>{connected ? 'Connected' : 'Disconnected'}</Badge>
          </div>
          {!connected && <p>Sign in with your MEGA account below.</p>}
          <small>Cloud connection is managed by the launcher.</small>
        </div>
        {connected && (
          <Button
            secondary
            disabled={disabled || emulator?.running}
            onClick={() => setChangeMegaAccount((value) => !value)}
          >
            {changeMegaAccount ? 'Cancel account change' : 'Change MEGA account'}
          </Button>
        )}
      </section>
      {(!connected || changeMegaAccount) && <MegaConnectionForm connection={connection} />}
      <section className="panel sync-card">
        <h3>Automatic save synchronization</h3>
        <p>
          {snapshot?.settings.autoSyncSaves
            ? 'Saves merge before playing and after PCSX2 closes. Keep the launcher open while playing.'
            : 'Automatic synchronization is disabled in Settings.'}
        </p>
        <p>Conflicts ask which version to use. Replaced files remain in backups.</p>
        <Button
          secondary
          disabled={disabled || !connected || emulator?.running}
          onClick={() =>
            void act('Synchronizing saves', () => api!.syncSaves(), 'Cloud saves synchronized', false)
          }
        >
          <RefreshCw size={15} /> Sync saves now
        </Button>
      </section>
      <div className="section-heading">
        <div>
          <h2>Save synchronization</h2>
        </div>
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => void act('Checking connection', async () => {}, undefined, false)}
        >
          <RefreshCw size={15} /> Check connection
        </button>
      </div>
      <div className="two-columns">
        {(
          [
            {
              kind: 'Memcards',
              title: 'Memory cards',
              icon: HardDrive,
              description: 'In-game saves.',
              local: snapshot?.settings.memcardsDirectory,
              upload: 'Upload Memory Cards',
              download: 'Download Memory Cards',
            },
            {
              kind: 'SaveStates',
              title: 'Save states',
              icon: Layers3,
              description: 'Use the same PCSX2 version across devices.',
              local: snapshot?.settings.saveStatesDirectory,
              upload: 'Upload Save States',
              download: 'Download Save States',
            },
          ] as const
        ).map((item) => (
          <section className="panel sync-card" key={item.kind}>
            <div className="sync-card-head">
              <div className="panel-symbol">
                <item.icon />
              </div>
              <span className="folder-label">/{item.kind}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <code>{item.local}</code>
            <div className="sync-buttons">
              <Button
                secondary
                disabled={disabled || !connected || emulator?.running}
                onClick={() => void preview({ kind: item.kind, direction: 'upload' })}
              >
                <ArrowUpFromLine size={15} />
                {item.upload}
              </Button>
              <Button
                secondary
                disabled={disabled || !connected || emulator?.running}
                onClick={() => void preview({ kind: item.kind, direction: 'download' })}
              >
                <ArrowDownToLine size={15} />
                {item.download}
              </Button>
            </div>
          </section>
        ))}
      </div>
      {emulator?.running && (
        <div className="message">
          Close PCSX2 before synchronizing saves. Use Check connection afterward to refresh status.
        </div>
      )}
      <div className="cloud-location">
        <FolderOpen size={16} />{' '}
        {snapshot ? `${snapshot.settings.remote}:${snapshot.settings.cloudRoot || ''}/` : providerName}
        <span>Games / Memcards / SaveStates</span>
      </div>
      <div className="page-links">
        <button className="text-button" onClick={() => goToSettings('Cloud')}>
          Configure cloud <ArrowRight size={16} />
        </button>
        <button className="text-button muted" onClick={() => void api?.openLink(provider)}>
          {providerName} connection help <ExternalLink size={14} />
        </button>
        <button
          className="text-button muted"
          onClick={() => void api?.openTransferLogs().catch((e) => setError(e.message))}
        >
          Open transfer logs <FolderOpen size={14} />
        </button>
      </div>
    </>
  );
}
