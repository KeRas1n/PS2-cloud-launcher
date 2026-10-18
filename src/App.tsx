import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  CloudOff,
  Disc3,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  HardDrive,
  ImagePlus,
  Layers3,
  LoaderCircle,
  MonitorDown,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { Game, Library, Progress, Settings, Snapshot, SyncPlan, SyncRequest } from '../shared/types';

type Page = 'Games' | 'Emulator' | 'Cloud' | 'Settings';
const api = window.launcher;
const navigation = [
  { name: 'Games', icon: Gamepad2 },
  { name: 'Emulator', icon: MonitorDown },
  { name: 'Cloud', icon: Cloud },
  { name: 'Settings', icon: Settings2 },
] as const;
export function size(bytes: number) {
  if (!bytes) return '0 B';
  const unit = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4));
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}
function Button({
  children,
  onClick,
  disabled,
  secondary = false,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  secondary?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`button ${secondary ? 'secondary' : 'primary'} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Badge({ children, good = false }: { children: ReactNode; good?: boolean }) {
  return (
    <span className={`badge ${good ? 'good' : ''}`}>
      <span />
      {children}
    </span>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>('Games');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [library, setLibrary] = useState<Library>({ games: [], warnings: [], cloudChecked: false });
  const [draft, setDraft] = useState<Settings>();
  const [busy, setBusy] = useState('');
  const [booting, setBooting] = useState(true);
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All games');
  const [plan, setPlan] = useState<SyncPlan>();
  const [compact, setCompact] = useState(false);
  async function refresh(scan = true) {
    if (!api) return;
    const value = await api.snapshot();
    setSnapshot(value);
    setDraft(value.settings);
    if (scan) setLibrary(await api.library());
  }
  useEffect(() => {
    const unsubscribe = api?.onProgress(setProgress);
    if (api)
      refresh()
        .catch((e) => setError(String(e.message)))
        .finally(() => setBooting(false));
    else {
      setError('Desktop connection unavailable. Open this application through Electron using npm run dev.');
      setBooting(false);
    }
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!plan) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const buttons = () => [...(dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    buttons()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        void cancelPreview();
      }
      if (event.key === 'Tab') {
        const items = buttons(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, [plan, busy]);
  async function act(label: string, action: () => Promise<unknown>, success?: string, scan = true) {
    if (busy) return;
    setBusy(label);
    setError('');
    setProgress(undefined);
    try {
      await action();
      await refresh(scan);
      if (success) setNotice(success);
    } catch (e) {
      setProgress(undefined);
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function preview(request: SyncRequest) {
    if (!api || busy) return;
    setBusy('Preparing transfer');
    setError('');
    setProgress(undefined);
    try {
      setPlan(await api.planSync(request));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function cancelPreview() {
    if (plan && api) await api.cancelPlan(plan.id);
    setPlan(undefined);
  }
  const settingsChanged = !!draft && JSON.stringify(draft) !== JSON.stringify(snapshot?.settings);
  const disabled = !!busy || booting || !api;
  const games = library.games.filter(
    (g) =>
      g.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'All games' || (filter === 'Installed' ? !!g.localPath : g.state === 'Cloud Only')),
  );
  const localCount = library.games.filter((g) => g.localPath).length;
  const cloudCount = library.games.filter((g) => g.cloudPath).length;
  const connected = !!snapshot?.cloud.connected;
  const emulator = snapshot?.emulator;
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  async function pickSetting(key: keyof Settings, kind: 'directory' | 'executable' = 'directory') {
    if (!api) return;
    const value = await api.pick(kind);
    if (value) setDraft((d) => (d ? { ...d, [key]: value } : d));
  }
  async function addDirectory() {
    if (!api) return;
    const directory = await api.pick('directory');
    if (directory)
      setDraft((d) => (d ? { ...d, gameDirectories: [...new Set([...d.gameDirectories, directory])] } : d));
  }
  const settingField = (
    label: string,
    key: keyof Settings,
    help: string,
    kind?: 'directory' | 'executable',
  ) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <div className="path-input">
        <input
          value={String(draft?.[key] ?? '')}
          onChange={(e) => update(key, e.target.value as never)}
          disabled={disabled}
          spellCheck={false}
        />
        {kind && (
          <button
            title={`Browse ${label}`}
            aria-label={`Browse ${label}`}
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault();
              void pickSetting(key, kind).catch((e) => setError(e.message));
            }}
          >
            <FolderOpen size={17} />
          </button>
        )}
      </div>
      <small>{help}</small>
    </label>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Layers3 size={25} />
          </div>
          <div>
            PS2<span>CLOUD LAUNCHER</span>
          </div>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
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
        <div className="sidebar-bottom">
          <div className="cloud-summary">
            <div className="cloud-summary-icon">
              <Cloud size={20} />
            </div>
            <div>
              <strong>Your private cloud</strong>
              <small>{connected ? 'Dropbox connected' : 'Connect your Dropbox'}</small>
            </div>
            <i className={connected ? 'online' : ''} />
          </div>
          <p>
            Your games. Your saves.
            <br />
            Always your own.
          </p>
          <div className="build-info">
            <span className="tiny-dot" /> LOCAL FIRST <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <Badge good={connected}>{connected ? 'Dropbox connected' : 'Cloud disconnected'}</Badge>
            <span className="header-divider" />
            <button
              className="icon-button"
              title="Settings"
              aria-label="Settings"
              onClick={() => setPage('Settings')}
            >
              <Settings2 size={18} />
            </button>
            <div className="avatar">P2</div>
          </div>
        </header>
        <main>
          {error && (
            <div role="alert" className="message error">
              <CloudOff size={19} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={17} />
              </button>
            </div>
          )}
          {booting && (
            <div className="loading">
              <LoaderCircle className="spin" size={20} /> Checking emulator and cloud connection…
            </div>
          )}
          {page === 'Games' && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span /> YOUR NEXT SESSION STARTS HERE
                  </div>
                  <h1>
                    A legendary library.
                    <br />
                    <span>Without limits.</span>
                  </h1>
                  <p>
                    Bring your PlayStation 2 collection together.
                    <br />
                    Play locally. Pick up from your own cloud.
                  </p>
                  <div className="hero-actions">
                    <Button onClick={() => setPage('Settings')}>
                      <Plus size={17} /> Add game folder
                    </Button>
                    <button className="text-button" onClick={() => setPage(connected ? 'Cloud' : 'Emulator')}>
                      {connected ? 'Manage cloud' : 'Set up your launcher'}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="console-mark">Ⅱ</div>
                  <div className="floating-label">
                    <Gamepad2 size={16} /> PLAYSTATION 2
                  </div>
                  <div className="art-caption">THE CLASSICS LIVE ON</div>
                </div>
              </section>
              <div className="library-stats">
                <span>
                  <HardDrive size={16} />
                  <strong>{localCount}</strong> installed
                </span>
                <span>
                  <Cloud size={16} />
                  <strong>{cloudCount}</strong> in cloud
                </span>
                <span>
                  <Disc3 size={16} />
                  <strong>
                    {size(library.games.filter((g) => g.localPath).reduce((n, g) => n + g.size, 0))}
                  </strong>{' '}
                  local library
                </span>
                <div className="stats-note">
                  <ShieldCheck size={15} /> Your account. No subscription.
                </div>
              </div>
              <div className="section-heading">
                <div>
                  <div className="eyebrow muted">YOUR COLLECTION</div>
                  <h2>
                    Game library <span>{library.games.length}</span>
                  </h2>
                </div>
                <Button
                  secondary
                  disabled={disabled}
                  onClick={() => void act('Refreshing library', async () => {}, undefined)}
                >
                  <RefreshCw size={15} className={busy === 'Refreshing library' ? 'spin' : ''} /> Refresh
                  library
                </Button>
              </div>
              <div className="library-toolbar">
                <div className="tabs">
                  {['All games', 'Installed', 'Cloud only'].map((tab) => (
                    <button
                      key={tab}
                      className={filter === tab ? 'selected' : ''}
                      onClick={() => setFilter(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="toolbar-right">
                  <label className="search">
                    <Search size={16} />
                    <input
                      placeholder="Search your collection"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      aria-label="Search games"
                    />
                  </label>
                  <button
                    className={`icon-button view-toggle ${compact ? 'selected' : ''}`}
                    title="Toggle compact grid"
                    aria-label="Toggle compact grid"
                    aria-pressed={compact}
                    onClick={() => setCompact(!compact)}
                  >
                    <SlidersHorizontal size={17} />
                  </button>
                </div>
              </div>
              {!!library.warnings.length && (
                <details className="warnings">
                  <summary>
                    {library.warnings.length} library notice{library.warnings.length !== 1 ? 's' : ''}
                    {!library.cloudChecked ? ' · Cloud status not verified' : ''}
                  </summary>
                  {library.warnings.map((warning, index) => (
                    <p key={index}>{warning}</p>
                  ))}
                </details>
              )}
              {games.length ? (
                <div className={`game-grid ${compact ? 'compact' : ''}`}>
                  {games.map((game, index) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      index={index}
                      cloudChecked={library.cloudChecked}
                      disabled={disabled}
                      connected={connected}
                      onPlay={() =>
                        void act('Starting PCSX2', () => api!.openEmulator(game.id), 'PCSX2 launched', false)
                      }
                      onTransfer={(direction) => void preview({ kind: 'Games', direction, gameId: game.id })}
                      onCover={() => void act('Importing cover', () => api!.setCover(game.id))}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-library">
                  <div className="empty-disc">
                    <Disc3 size={42} />
                    <span>
                      <Plus size={14} />
                    </span>
                  </div>
                  <h3>
                    {query || filter !== 'All games' ? 'No matching games' : 'Make room for the classics'}
                  </h3>
                  <p>
                    {query || filter !== 'All games'
                      ? 'Try another search or library filter.'
                      : 'Add a folder with your .iso or .chd files, or connect Dropbox to discover your cloud library.'}
                  </p>
                  {!query && filter === 'All games' && (
                    <div className="empty-actions">
                      <Button secondary onClick={() => setPage('Settings')}>
                        <FolderOpen size={16} /> Choose game folders
                      </Button>
                      <button className="text-button" onClick={() => setPage('Cloud')}>
                        Connect Dropbox <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  <span className="file-types">
                    ISO <span /> CHD <span /> WINDOWS & LINUX
                  </span>
                </div>
              )}
              <div className="library-footnote">
                <ShieldCheck size={15} />
                <span>Built for your own collection. No games or BIOS files are included.</span>
                <span className="footnote-right">POWERED BY PCSX2 + RCLONE</span>
              </div>
            </>
          )}
          {page === 'Emulator' && (
            <>
              <PageHeading
                eyebrow="THE ENGINE BEHIND YOUR GAMES"
                title="Emulator"
                description="Official PCSX2. Managed locally, ready when you are."
              />
              <section className="panel emulator-panel">
                <div className="emulator-logo">
                  PS<span>2</span>
                </div>
                <div className="emulator-detail">
                  <div className="row">
                    <h2>PCSX2</h2>
                    <Badge good={!!emulator?.installed}>
                      {emulator?.installed ? 'Installed' : 'Not installed'}
                    </Badge>
                  </div>
                  <p>Open-source PlayStation 2 emulator</p>
                  <div className="emulator-version">
                    {emulator?.version || 'Latest stable release from the official GitHub repository'}
                  </div>
                  {emulator?.path && <code>{emulator.path}</code>}
                  <div className="button-row">
                    <Button
                      disabled={disabled || emulator?.running}
                      onClick={() =>
                        void act(
                          emulator?.installed ? 'Updating PCSX2' : 'Installing PCSX2',
                          () => api!.installEmulator(),
                          'PCSX2 ready. Existing data preserved.',
                          false,
                        )
                      }
                    >
                      <ArrowDownToLine size={16} />
                      {emulator?.installed ? 'Update PCSX2' : 'Install PCSX2'}
                    </Button>
                    <Button
                      secondary
                      disabled={disabled || !emulator?.installed || emulator?.running}
                      onClick={() =>
                        void act('Starting PCSX2', () => api!.openEmulator(), 'PCSX2 launched', false)
                      }
                    >
                      <ExternalLink size={16} /> Open PCSX2
                    </Button>
                  </div>
                </div>
              </section>
              <div className="two-columns">
                <section className="panel">
                  <div className="panel-symbol">
                    <ShieldCheck />
                  </div>
                  <h3>Bring your own BIOS</h3>
                  <p>
                    Import a BIOS dumped from your own PlayStation 2. Select it in the PCSX2 setup wizard
                    before your first game.
                  </p>
                  <Button
                    secondary
                    disabled={disabled || emulator?.running}
                    onClick={() =>
                      void act(
                        'Importing BIOS',
                        async () => {
                          const count = await api!.importBios();
                          if (count) setNotice('BIOS imported. Select it in PCSX2.');
                        },
                        undefined,
                        false,
                      )
                    }
                  >
                    <Plus size={16} /> Import BIOS
                  </Button>
                </section>
                <section className="panel">
                  <div className="panel-symbol">
                    <HardDrive />
                  </div>
                  <h3>Your progress stays put</h3>
                  <p>
                    Updates install into versioned folders. BIOS, settings, memory cards, and save states stay
                    in your persistent data directory.
                  </p>
                  <code>{snapshot?.settings.dataDirectory ?? 'Loading data directory…'}</code>
                </section>
              </div>
              <section className="panel info-strip">
                <span>
                  <strong>Already have PCSX2?</strong>
                  <br />
                  Choose its executable and existing data folders in Settings.
                </span>
                <button className="text-button" onClick={() => setPage('Settings')}>
                  Configure paths <ArrowRight size={16} />
                </button>
              </section>
              <button className="text-button muted" onClick={() => void api?.openLink('pcsx2')}>
                PCSX2 setup documentation <ExternalLink size={14} />
              </button>
            </>
          )}
          {page === 'Cloud' && (
            <>
              <PageHeading
                eyebrow="YOUR COLLECTION, CONNECTED"
                title="Cloud saves. More freedom."
                description="Connect your own Dropbox. Keep your library and progress within reach."
              />
              <section className="panel provider-panel">
                <div className="dropbox-logo" aria-hidden="true">
                  ◇
                </div>
                <div className="provider-copy">
                  <div className="row">
                    <h2>Dropbox</h2>
                    <Badge good={connected}>{connected ? 'Connected' : 'Disconnected'}</Badge>
                  </div>
                  <p>Secure OAuth connection through Rclone. No personal API keys needed.</p>
                  <small>{snapshot?.cloud.version ?? 'Rclone needs to be installed'}</small>
                </div>
                <Button
                  disabled={disabled || !snapshot?.cloud.installed}
                  onClick={() =>
                    void act('Connecting Dropbox', () => api!.connectCloud(), 'Dropbox connected')
                  }
                >
                  <Cloud size={16} />
                  {connected ? 'Reconnect' : 'Connect Dropbox'}
                </Button>
              </section>
              {!connected && (
                <section className="panel setup-panel">
                  <h3>Three steps to your private cloud</h3>
                  <div className="setup-steps">
                    <div>
                      <b className={snapshot?.cloud.installed ? 'done' : ''}>
                        {snapshot?.cloud.installed ? <Check size={16} /> : '1'}
                      </b>
                      <strong>Install Rclone</strong>
                      <p>Download the official build, or select your own executable.</p>
                      <Button
                        secondary
                        disabled={disabled}
                        onClick={() =>
                          void act('Installing Rclone', () => api!.installRclone(), 'Rclone installed', false)
                        }
                      >
                        <ArrowDownToLine size={15} />{' '}
                        {snapshot?.cloud.installed ? 'Reinstall Rclone' : 'Install Rclone'}
                      </Button>
                    </div>
                    <div>
                      <b>2</b>
                      <strong>Authorize Dropbox</strong>
                      <p>
                        Click Connect Dropbox and approve access in your browser. Credentials stay in your
                        local Rclone configuration.
                      </p>
                    </div>
                    <div>
                      <b>3</b>
                      <strong>Choose what moves</strong>
                      <p>
                        Review each transfer. Existing files are backed up before replacement. Missing local
                        files never delete cloud files.
                      </p>
                    </div>
                  </div>
                </section>
              )}
              <div className="section-heading">
                <div>
                  <div className="eyebrow muted">MANUAL SYNC</div>
                  <h2>Keep your progress close</h2>
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
                      description: 'Your in-game saves, just like the original console.',
                      local: snapshot?.settings.memcardsDirectory,
                      upload: 'Upload Memory Cards',
                      download: 'Download Memory Cards',
                    },
                    {
                      kind: 'SaveStates',
                      title: 'Save states',
                      icon: Layers3,
                      description: 'Your exact moments. Use the same PCSX2 version across devices.',
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
              <section className="panel info-strip">
                <div>
                  <strong>Disc images live in their own folder.</strong>
                  <p>Upload and download individual games from your library.</p>
                </div>
                <button className="text-button" onClick={() => setPage('Games')}>
                  Open library <ArrowRight size={16} />
                </button>
              </section>
              <div className="cloud-location">
                <FolderOpen size={16} />{' '}
                {snapshot ? `${snapshot.settings.remote}:${snapshot.settings.cloudRoot || ''}/` : 'Dropbox'}
                <span>Games / Memcards / SaveStates</span>
              </div>
              <button className="text-button muted" onClick={() => void api?.openLink('rclone')}>
                Rclone installation help <ExternalLink size={14} />
              </button>
            </>
          )}
          {page === 'Settings' && (
            <>
              <div className="settings-heading">
                <PageHeading
                  eyebrow="MAKE IT YOURS"
                  title="Settings"
                  description="Local paths, cloud preferences, and the way you play."
                />
                <Button
                  disabled={disabled || !settingsChanged}
                  onClick={() =>
                    void act('Saving preferences', () => api!.saveSettings(draft!), 'Preferences saved')
                  }
                >
                  <Check size={17} /> Save changes
                </Button>
              </div>
              {settingsChanged && (
                <div className="unsaved">
                  Unsaved changes. Save before scanning, connecting, or transferring files.
                </div>
              )}
              <section className="panel settings-panel">
                <div className="settings-section-title">
                  <FolderOpen size={20} />
                  <div>
                    <h3>Game library</h3>
                    <p>
                      Scan folders recursively for .iso and .chd files. Filename identifies each cloud game.
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
                {settingField(
                  'Game download directory',
                  'downloadDirectory',
                  'Cloud downloads are saved here. This folder is scanned automatically.',
                  'directory',
                )}
              </section>
              <section className="panel settings-panel">
                <div className="settings-section-title">
                  <MonitorDown size={20} />
                  <div>
                    <h3>PCSX2 & local data</h3>
                    <p>Paths must be absolute. PCSX2 uses this data directory through -datapath.</p>
                  </div>
                </div>
                {settingField(
                  'PCSX2 executable',
                  'pcsx2Path',
                  'Leave empty for automatic detection. Select .exe on Windows or AppImage / executable on Linux.',
                  'executable',
                )}
                {settingField(
                  'Emulator installation directory',
                  'emulatorRoot',
                  'New managed versions install here. Changing this path does not move existing data.',
                  'directory',
                )}
                {settingField(
                  'PCSX2 data directory',
                  'dataDirectory',
                  'Use your existing portable folder to preserve settings. Other configured folders below remain independent.',
                  'directory',
                )}
                <div className="field-grid">
                  {settingField(
                    'BIOS directory',
                    'biosDirectory',
                    'Your own console BIOS files.',
                    'directory',
                  )}
                  {settingField(
                    'Memory card directory',
                    'memcardsDirectory',
                    'PCSX2 memory cards and cloud Memcards source.',
                    'directory',
                  )}
                  {settingField(
                    'Save state directory',
                    'saveStatesDirectory',
                    'PCSX2 save states and cloud SaveStates source.',
                    'directory',
                  )}
                </div>
                <label className="toggle-field">
                  <div>
                    <strong>Launch games in fullscreen</strong>
                    <small>Open PCSX2 directly into the game.</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft?.fullscreen ?? true}
                    disabled={disabled}
                    onChange={(e) => update('fullscreen', e.target.checked)}
                  />
                </label>
              </section>
              <section className="panel settings-panel">
                <div className="settings-section-title">
                  <Cloud size={20} />
                  <div>
                    <h3>Rclone & Dropbox</h3>
                    <p>Tokens stay in the local Rclone configuration. Never add that file to Git.</p>
                  </div>
                </div>
                {settingField(
                  'Rclone executable',
                  'rclonePath',
                  'Use rclone for PATH detection, or choose its absolute executable path.',
                  'executable',
                )}
                {settingField(
                  'Rclone configuration file',
                  'rcloneConfig',
                  'Use a dedicated configuration, or enter the path to your existing rclone.conf. Tokens are never shown here.',
                )}
                <div className="field-grid">
                  {settingField(
                    'Dropbox remote name',
                    'remote',
                    'An existing Dropbox remote or a new name for the connection wizard.',
                  )}
                  {settingField(
                    'Dropbox root folder',
                    'cloudRoot',
                    'Relative folder inside Dropbox. Leave empty to use the account root.',
                  )}
                </div>
                {!!snapshot?.cloud.remotes.length && (
                  <div className="remote-list">Available remotes: {snapshot.cloud.remotes.join(', ')}</div>
                )}
              </section>
              <div className="settings-footer">
                <span>Preferences stay on this device.</span>
                <Button
                  disabled={disabled || !settingsChanged}
                  onClick={() =>
                    void act('Saving preferences', () => api!.saveSettings(draft!), 'Preferences saved')
                  }
                >
                  <Check size={16} /> Save changes
                </Button>
              </div>
            </>
          )}
        </main>
        {(busy || progress) && (
          <div className="operation-bar" role="status">
            <div className="operation-symbol">
              {busy ? <LoaderCircle size={19} className="spin" /> : <CheckCircle2 size={19} />}
            </div>
            <div className="operation-detail">
              <strong>{busy || 'Activity'}</strong>
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
              {progress?.speed ? ` · ${size(progress.speed)}/s` : ''}
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
        )}
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {plan && (
        <div className="modal-backdrop">
          <section role="dialog" aria-modal="true" aria-labelledby="transfer-title" className="modal">
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
              {plan.direction === 'upload' ? 'Upload to Dropbox' : 'Download to this device'}
            </h2>
            <p>
              {plan.files.length} file{plan.files.length !== 1 ? 's' : ''} · {size(plan.bytes)} · {plan.kind}
            </p>
            {plan.files.some((f) => f.replaces) ? (
              <div className="conflict-warning">
                Files marked “Replace” will overwrite existing{' '}
                {plan.direction === 'upload' ? 'cloud' : 'local'} files. A backup is created before each
                replacement.
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
              No files will be deleted because they are missing from the source. Keep PCSX2 closed until the
              transfer finishes.
            </p>
            <div className="modal-actions">
              <Button secondary disabled={!!busy} onClick={() => void cancelPreview()}>
                Cancel
              </Button>
              <Button
                disabled={!!busy}
                onClick={() => {
                  const current = plan;
                  setPlan(undefined);
                  void act(
                    'Synchronizing files',
                    () => api!.executeSync(current.id, true),
                    'Transfer complete. Library refreshed.',
                  );
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
          </section>
        </div>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div className="eyebrow muted">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function GameCard({
  game,
  index,
  disabled,
  connected,
  cloudChecked,
  onPlay,
  onTransfer,
  onCover,
}: {
  game: Game;
  index: number;
  disabled: boolean;
  connected: boolean;
  cloudChecked: boolean;
  onPlay: () => void;
  onTransfer: (direction: 'upload' | 'download') => void;
  onCover: () => void;
}) {
  const download = game.state === 'Cloud Only';
  return (
    <article className="game-card" style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
      <div className={`game-cover cover-color-${index % 6}`}>
        {game.cover ? (
          <img src={game.cover} alt={`${game.title} cover`} />
        ) : (
          <div className="generated-cover">
            <div className="cover-console">PLAYSTATION 2</div>
            <Disc3 size={56} />
            <strong>{game.title}</strong>
            <span>PERSONAL COLLECTION</span>
          </div>
        )}
        <div className="cover-overlay">
          <button
            className="cover-edit"
            title="Import cover art"
            aria-label={`Import cover for ${game.title}`}
            disabled={disabled}
            onClick={onCover}
          >
            <ImagePlus size={18} />
          </button>
          <button
            className="cover-play"
            disabled={disabled}
            aria-label={download ? `Download ${game.title}` : `Play ${game.title}`}
            onClick={download ? () => onTransfer('download') : onPlay}
          >
            {download ? <ArrowDownToLine size={25} /> : <Play size={27} fill="currentColor" />}
          </button>
        </div>
        <span className="cover-format">{game.name.split('.').pop()?.toUpperCase()}</span>
      </div>
      <div className="game-info">
        <h3 title={game.title}>{game.title}</h3>
        <div className="game-meta">
          <span className={game.state === 'In Cloud' ? 'synced' : ''}>
            {game.cloudPath ? <Cloud size={12} /> : <HardDrive size={12} />}{' '}
            {cloudChecked || game.cloudPath ? game.state : 'Cloud unchecked'}
          </span>
          <span>{size(game.size)}</span>
        </div>
        <div className="game-actions">
          <button
            className={download ? 'download-game' : 'play-game'}
            disabled={disabled || (download && !connected)}
            onClick={download ? () => onTransfer('download') : onPlay}
          >
            {download ? <ArrowDownToLine size={14} /> : <Play size={14} fill="currentColor" />}
            {download ? 'Download' : 'Play'}
          </button>
          {game.state === 'Local Only' && (
            <button
              className="upload-game"
              title="Upload to Cloud"
              disabled={disabled || !connected}
              onClick={() => onTransfer('upload')}
            >
              <ArrowUpFromLine size={14} />
              <span>Upload to Cloud</span>
            </button>
          )}
          {game.state === 'In Cloud' && (
            <span className="cloud-check" title="Available locally and in Dropbox">
              <CheckCircle2 size={16} />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
