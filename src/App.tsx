import { LauncherProvider } from './app/LauncherProvider';
import { useLauncher } from './app/useLauncher';
import { CloudPage } from './features/cloud/CloudPage';
import { EmulatorPage } from './features/emulator/EmulatorPage';
import { DeleteGameDialog } from './features/games/DeleteGameDialog';
import { GamesPage } from './features/games/GamesPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { DownloadsPage } from './features/transfers/DownloadsPage';
import { SyncPreviewDialog } from './features/transfers/SyncPreviewDialog';
import { ActivityBar } from './layout/ActivityBar';
import { ErrorBanner } from './layout/ErrorBanner';
import { Loading } from './layout/Loading';
import { Notifications } from './layout/Notifications';
import { Sidebar } from './layout/Sidebar';
import { Topbar } from './layout/Topbar';
function Launcher() {
  const { page } = useLauncher();
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="workspace">
        <Topbar />
        <main>
          <ErrorBanner />
          <Loading />
          {page === 'Games' && <GamesPage />}
          {page === 'Emulator' && <EmulatorPage />}
          {page === 'Cloud' && <CloudPage />}
          {page === 'Settings' && <SettingsPage />}
          {page === 'Downloads' && <DownloadsPage />}
        </main>
        <ActivityBar />
      </div>
      <Notifications />
      <DeleteGameDialog />
      <SyncPreviewDialog />
    </div>
  );
}
export default function App() {
  return (
    <LauncherProvider>
      <Launcher />
    </LauncherProvider>
  );
}
