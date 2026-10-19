import { ArrowDownToLine, ChevronRight, Layers3 } from 'lucide-react';
import { navigation } from '../app/navigation';
import { useLauncher } from '../app/useLauncher';
import { transferRate } from '../lib/format';
import { version } from '../../package.json';
import { LauncherUpdateNotice } from './LauncherUpdateNotice';
export function Sidebar() {
  const { page, setPage, library, activeTransfers } = useLauncher();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">
          <Layers3 size={25} />
        </div>
        <div>
          PS2<span>CLOUD LAUNCHER</span>
        </div>
      </div>
      <small className="brand-version">v{version}</small>
      <nav aria-label="Main navigation">
        {navigation.map(({ name, icon: Icon }) => (
          <button
            key={name}
            aria-label={name}
            className={`nav-item ${page === name ? 'active' : ''}`}
            onClick={() => setPage(name)}
          >
            <Icon size={20} />
            <span>{name}</span>
            {name === 'Games' && <b>{library.games.length}</b>}
            {page === name && name !== 'Games' && <ChevronRight size={15} />}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <LauncherUpdateNotice />
        <button
          className={`nav-item downloads-nav ${page === 'Downloads' ? 'active' : ''}`}
          aria-label="Download manager"
          title="Download manager"
          onClick={() => setPage('Downloads')}
        >
          <ArrowDownToLine size={20} />
          <div className="download-manager-label">
            <span>Downloads</span>
            <small>
              {activeTransfers.length
                ? `${activeTransfers.length} active · ${transferRate(activeTransfers.reduce((sum, item) => sum + item.speed, 0))}`
                : 'Downloads & uploads'}
            </small>
          </div>
          {!!activeTransfers.length && <b>{activeTransfers.length}</b>}
        </button>
      </div>
    </aside>
  );
}
