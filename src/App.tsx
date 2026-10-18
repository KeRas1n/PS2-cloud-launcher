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
import type {
  CloudProvider,
  Game,
  Library,
  Progress,
  Settings,
  Snapshot,
  SyncPlan,
  SyncRequest,
} from '../shared/types';

type SettingsTab = 'Games' | 'Emulator' | 'Cloud';
const settingsTabs: SettingsTab[] = ['Games', 'Emulator', 'Cloud'];
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
export function transferRate(bytes: number) {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB/s`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB/s`;
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('Games');
  function goToSettings(tab: SettingsTab) {
    setSettingsTab(tab);
    setPage('Settings');
  }
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [library, setLibrary] = useState<Library>({ games: [], warnings: [], cloudChecked: false });
  const [draft, setDraft] = useState<Settings>();
  const [busy, setBusy] = useState('');
  const [saveSyncRunning, setSaveSyncRunning] = useState(false);
  const [booting, setBooting] = useState(true);
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All games');
  const [plan, setPlan] = useState<SyncPlan>();
  const [compact, setCompact] = useState(false);
  const [megaEmail, setMegaEmail] = useState('');
  const [megaPassword, setMegaPassword] = useState('');
  const [megaCode, setMegaCode] = useState('');
  const [changeMegaAccount, setChangeMegaAccount] = useState(false);
  async function selectProvider(provider: CloudProvider) {
    setMegaEmail('');
    setMegaPassword('');
    setMegaCode('');
    setChangeMegaAccount(false);
    setLibrary({ games: [], warnings: [], cloudChecked: false });
    await act('Switching cloud storage', () => api!.selectCloudProvider(provider), 'Cloud storage changed');
  }
  async function connectMega() {
    const credentials = {
      email: megaEmail.trim(),
      password: megaPassword,
      ...(megaCode ? { code: megaCode } : {}),
    };
    setMegaPassword('');
    setMegaCode('');
    await act(
      'Connecting MEGA',
      async () => {
        await api!.connectCloud(credentials);
        setChangeMegaAccount(false);
      },
      'MEGA connected',
    );
  }
  async function refresh(scan = true) {
    if (!api) return;
    const value = await api.snapshot();
    setSnapshot(value);
    setDraft(value.settings);
    if (scan) setLibrary(await api.library());
  }
  useEffect(() => {
    const unsubscribe = api?.onProgress((progress) => {
      setProgress(progress);
      if (progress.saveSyncRunning !== undefined) setSaveSyncRunning(progress.saveSyncRunning);
      if (progress.emulatorRunning !== undefined) {
        setSnapshot((current) =>
          current
            ? { ...current, emulator: { ...current.emulator, running: progress.emulatorRunning! } }
            : current,
        );
      }
    });
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
  const disabled = !!busy || saveSyncRunning || booting || !api;
  const games = library.games.filter(
    (g) =>
      g.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'All games' || (filter === 'Installed' ? !!g.localPath : g.state === 'Cloud Only')),
  );
  const localCount = library.games.filter((g) => g.localPath).length;
  const cloudCount = library.games.filter((g) => g.cloudPath).length;
  const connected = !!snapshot?.cloud.connected;
  const provider = snapshot?.settings.cloudProvider ?? 'dropbox';
  const providerName = provider === 'mega' ? 'MEGA' : 'Dropbox';
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
      </aside>
      <div className="workspace">
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
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    Game library <span>{library.games.length}</span>
                  </h2>
                </div>
                <div className="button-row">
                  <Button secondary onClick={() => goToSettings('Games')}>
                    <Plus size={16} /> Add game folder
                  </Button>
                  <Button
                    secondary
                    disabled={disabled}
                    onClick={() => void act('Refreshing library', async () => {}, undefined)}
                  >
                    <RefreshCw size={15} className={busy === 'Refreshing library' ? 'spin' : ''} /> Refresh
                    library
                  </Button>
                </div>
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
                      placeholder="Search games"
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
                  <h3>{query || filter !== 'All games' ? 'No matching games' : 'No games found'}</h3>
                  <p>
                    {query || filter !== 'All games'
                      ? 'Try another search or library filter.'
                      : `Add a folder with your .iso or .chd files, or connect ${providerName} to discover your cloud library.`}
                  </p>
                  {!query && filter === 'All games' && (
                    <div className="empty-actions">
                      <Button secondary onClick={() => goToSettings('Games')}>
                        <FolderOpen size={16} /> Choose game folders
                      </Button>
                      <button className="text-button" onClick={() => setPage('Cloud')}>
                        Connect {providerName} <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {page === 'Emulator' && (
            <>
              <PageHeading title="Emulator" />
              <section className="panel emulator-panel">
                <div className="emulator-detail">
                  <div className="row">
                    <h2>PCSX2</h2>
                    <Badge good={!!emulator?.installed}>
                      {emulator?.installed ? 'Installed' : 'Not installed'}
                    </Badge>
                  </div>
                  <div className="emulator-version">
                    {emulator?.version || 'Latest stable release from the official GitHub repository'}
                  </div>
                  {emulator?.path && <code>{emulator.path}</code>}
                  {emulator?.profile?.directory && (
                    <div className="profile-directory">
                      Profile directory<code>{emulator.profile.directory}</code>
                    </div>
                  )}
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
                        void act(
                          'Preparing emulator',
                          () => api!.prepareEmulator(),
                          'Emulator profile prepared. Import your own BIOS before playing.',
                          false,
                        )
                      }
                    >
                      <ShieldCheck size={16} /> Prepare emulator
                    </Button>
                  </div>
                </div>
              </section>
              <section className="panel">
                <div className="panel-symbol">
                  <ShieldCheck />
                </div>
                <h3>BIOS</h3>
                <p>Import an uncompressed BIOS from your PlayStation 2.</p>
                <Button
                  secondary
                  disabled={disabled || emulator?.running}
                  onClick={() =>
                    void act(
                      'Importing BIOS',
                      async () => {
                        const count = await api!.importBios();
                        if (count) setNotice('BIOS imported. The launcher selects it automatically.');
                      },
                      undefined,
                      false,
                    )
                  }
                >
                  <Plus size={16} /> Import BIOS
                </Button>
                {!!emulator?.profile?.bios.length && (
                  <label className="field">
                    <span>Selected BIOS</span>
                    <select
                      className="profile-select"
                      value={emulator.profile.selectedBios ?? ''}
                      disabled={disabled || emulator.running || !emulator.installed}
                      onChange={(event) =>
                        void act(
                          'Selecting BIOS',
                          () => api!.selectBios(event.target.value),
                          'BIOS selected',
                          false,
                        )
                      }
                    >
                      {emulator.profile.bios.map((image) => (
                        <option key={image.name} value={image.name}>
                          {image.name} · {image.region} {image.version}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="profile-readiness">
                  <Badge good={!!emulator?.profile?.ready}>
                    {emulator?.profile?.ready
                      ? 'Ready to play'
                      : emulator?.profile?.bios.length
                        ? 'Prepared automatically on first launch'
                        : 'Import a valid BIOS to play'}
                  </Badge>
                </div>
              </section>
              <div className="page-links">
                <button className="text-button" onClick={() => goToSettings('Emulator')}>
                  Configure paths <ArrowRight size={16} />
                </button>
                <button className="text-button muted" onClick={() => void api?.openLink('pcsx2')}>
                  PCSX2 documentation <ExternalLink size={14} />
                </button>
              </div>
            </>
          )}
          {page === 'Cloud' && (
            <>
              <PageHeading title="Cloud" />
              <label className="field cloud-provider-select">
                <span>Cloud storage</span>
                <select
                  className="profile-select"
                  value={provider}
                  disabled={disabled || emulator?.running}
                  onChange={(e) => void selectProvider(e.target.value as CloudProvider)}
                >
                  <option value="dropbox">Dropbox</option>
                  <option value="mega">MEGA</option>
                </select>
                <small>
                  Saved connections are kept. Switching selects storage; files transfer when syncing.
                </small>
              </label>
              <section className="panel provider-panel">
                <div className="provider-copy">
                  <div className="row">
                    <h2>{providerName}</h2>
                    <Badge good={connected}>{connected ? 'Connected' : 'Disconnected'}</Badge>
                  </div>
                  {!connected && (
                    <p>
                      {provider === 'mega'
                        ? 'Sign in with your MEGA account below.'
                        : 'Authorize Dropbox in your browser.'}
                    </p>
                  )}
                  <small>Cloud connection is managed by the launcher.</small>
                </div>
                {provider === 'dropbox' && (
                  <Button
                    disabled={disabled || emulator?.running}
                    onClick={() =>
                      void act('Connecting Dropbox', () => api!.connectCloud(), 'Dropbox connected')
                    }
                  >
                    <Cloud size={16} />
                    {connected ? 'Reconnect' : 'Connect Dropbox'}
                  </Button>
                )}
                {provider === 'mega' && connected && (
                  <Button
                    secondary
                    disabled={disabled || emulator?.running}
                    onClick={() => setChangeMegaAccount((value) => !value)}
                  >
                    {changeMegaAccount ? 'Cancel account change' : 'Change MEGA account'}
                  </Button>
                )}
              </section>
              {provider === 'mega' && (!connected || changeMegaAccount) && (
                <form
                  className="panel settings-panel mega-sign-in"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void connectMega();
                  }}
                >
                  <h3>Connect MEGA</h3>
                  <div className="field-grid">
                    <label className="field">
                      <span>MEGA email</span>
                      <input
                        type="email"
                        className="profile-select"
                        autoComplete="username"
                        required
                        value={megaEmail}
                        disabled={disabled || emulator?.running}
                        onChange={(e) => setMegaEmail(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>MEGA password</span>
                      <input
                        type="password"
                        className="profile-select"
                        autoComplete="off"
                        required
                        value={megaPassword}
                        disabled={disabled || emulator?.running}
                        onChange={(e) => setMegaPassword(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>MEGA two-factor code (optional)</span>
                    <input
                      className="profile-select"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={megaCode}
                      disabled={disabled || emulator?.running}
                      onChange={(e) => setMegaCode(e.target.value)}
                    />
                    <small>
                      For two-factor accounts, enter a fresh code. A new launcher session may require sign-in
                      again.
                    </small>
                  </label>
                  <p>Account access is stored locally. A new MEGA account must first be opened at mega.nz.</p>
                  <Button
                    disabled={
                      disabled ||
                      emulator?.running ||
                      !megaEmail.trim() ||
                      !megaPassword ||
                      (!!megaCode && !/^\d{6}$/.test(megaCode))
                    }
                  >
                    <Cloud size={16} /> Connect MEGA
                  </Button>
                  {!!snapshot?.cloud.remotes.includes(snapshot.settings.remote) && !connected && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={disabled || emulator?.running}
                      onClick={() =>
                        void act('Reconnecting MEGA', () => api!.connectCloud(), 'MEGA connected')
                      }
                    >
                      Retry saved MEGA connection
                    </button>
                  )}
                </form>
              )}
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
                {snapshot
                  ? `${snapshot.settings.remote}:${snapshot.settings.cloudRoot || ''}/`
                  : providerName}
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
          )}
          {page === 'Settings' && (
            <>
              <div className="settings-heading">
                <PageHeading title="Settings" />
                <Button
                  disabled={disabled || !settingsChanged}
                  onClick={() =>
                    void act('Saving preferences', () => api!.saveSettings(draft!), 'Preferences saved')
                  }
                >
                  <Check size={17} /> Save changes
                </Button>
              </div>
              <div className="settings-tabs" role="tablist" aria-label="Settings categories">
                {settingsTabs.map((tab, index) => (
                  <button
                    key={tab}
                    role="tab"
                    id={`settings-tab-${tab}`}
                    aria-selected={settingsTab === tab}
                    aria-controls={`settings-panel-${tab}`}
                    tabIndex={settingsTab === tab ? 0 : -1}
                    onClick={() => setSettingsTab(tab)}
                    onKeyDown={(event) => {
                      const next =
                        event.key === 'ArrowRight'
                          ? (index + 1) % settingsTabs.length
                          : event.key === 'ArrowLeft'
                            ? (index + settingsTabs.length - 1) % settingsTabs.length
                            : event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? settingsTabs.length - 1
                                : undefined;
                      if (next !== undefined) {
                        event.preventDefault();
                        setSettingsTab(settingsTabs[next]);
                        document.getElementById(`settings-tab-${settingsTabs[next]}`)?.focus();
                      }
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {settingsChanged && <div className="unsaved">Unsaved changes.</div>}
              {settingsTab === 'Games' && (
                <section
                  className="panel settings-panel"
                  role="tabpanel"
                  id="settings-panel-Games"
                  aria-labelledby="settings-tab-Games"
                  tabIndex={0}
                >
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
              )}
              {settingsTab === 'Emulator' && (
                <section
                  className="panel settings-panel"
                  role="tabpanel"
                  id="settings-panel-Emulator"
                  aria-labelledby="settings-tab-Emulator"
                  tabIndex={0}
                >
                  <div className="settings-section-title">
                    <MonitorDown size={20} />
                    <div>
                      <h3>PCSX2 & local data</h3>
                      <p>
                        Paths must be absolute. PCSX2 stores its profile in the PCSX2 subfolder of this data
                        parent.
                      </p>
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
                    'PCSX2 data parent directory',
                    'dataDirectory',
                    'PCSX2 creates a PCSX2 subfolder here. Existing settings and save folders are preserved; folders below remain independent.',
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
              )}
              {settingsTab === 'Cloud' && (
                <section
                  className="panel settings-panel"
                  role="tabpanel"
                  id="settings-panel-Cloud"
                  aria-labelledby="settings-tab-Cloud"
                  tabIndex={0}
                >
                  <div className="settings-section-title">
                    <Cloud size={20} />
                    <div>
                      <h3>{providerName}</h3>
                      <p>Connect your account from Cloud. The launcher includes the cloud component.</p>
                    </div>
                  </div>
                  <label className="toggle-field">
                    <span>Automatically sync saves before and after playing</span>
                    <input
                      type="checkbox"
                      checked={draft?.autoSyncSaves ?? true}
                      disabled={disabled}
                      onChange={(e) => update('autoSyncSaves', e.target.checked)}
                    />
                  </label>
                  {settingField(
                    `${providerName} root folder`,
                    'cloudRoot',
                    `Folder for games and saves inside your ${providerName}.`,
                  )}
                  <details>
                    <summary>Advanced cloud settings</summary>
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
                        `${providerName} remote name`,
                        'remote',
                        `An existing ${providerName} remote or a new name for the connection.`,
                      )}
                    </div>
                    {!!snapshot?.cloud.remotes.length && (
                      <div className="remote-list">
                        Available remotes: {snapshot.cloud.remotes.join(', ')}
                      </div>
                    )}
                  </details>
                </section>
              )}
            </>
          )}
        </main>
        {(busy || progress) && (
          <div className="operation-bar" role="status">
            <div className="operation-symbol">
              {busy || saveSyncRunning ? (
                <LoaderCircle size={19} className="spin" />
              ) : (
                <CheckCircle2 size={19} />
              )}
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
              {progress?.averageSpeed !== undefined ? ` · avg ${transferRate(progress.averageSpeed)}` : ''}
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
              {plan.direction === 'upload' ? `Upload to ${providerName}` : 'Download to this device'}
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

function PageHeading({ title }: { title: string }) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
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
            <span className="cloud-check" title="Available locally and in cloud storage">
              <CheckCircle2 size={16} />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
