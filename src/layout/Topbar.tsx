import { Settings2 } from 'lucide-react';
import { useLauncher } from '../app/useLauncher';
import { Badge } from '../components/Badge';
export function Topbar() {
  const { page, connected, providerName, setPage } = useLauncher();

  return (
    <header className="topbar">
      <div className="breadcrumb">
        <strong>{page}</strong>
      </div>
      <div className="topbar-actions">
        <Badge good={connected}>
          {connected ? `${providerName} connected` : `${providerName} disconnected`}
        </Badge>
        <span className="header-divider" />
        <button
          className="icon-button"
          title="Settings"
          aria-label="Settings"
          onClick={() => setPage('Settings')}
        >
          <Settings2 size={18} />
        </button>
      </div>
    </header>
  );
}
