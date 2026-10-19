import { createContext, type ReactNode } from 'react';
import { useGameDeletion } from '../features/games/useGameDeletion';
import { useLibraryView } from '../features/games/useLibraryView';
import { useSettingsDraft } from '../features/settings/useSettingsDraft';
import { useSyncPreview } from '../features/transfers/useSyncPreview';
import { useTransfers } from '../features/transfers/useTransfers';
import { useLauncherState } from './useLauncherState';
import { useNavigation } from './useNavigation';

type LauncherContextValue = ReturnType<typeof useLauncherState> &
  ReturnType<typeof useNavigation> &
  ReturnType<typeof useSettingsDraft> &
  ReturnType<typeof useTransfers> &
  ReturnType<typeof useSyncPreview> &
  ReturnType<typeof useGameDeletion> &
  ReturnType<typeof useLibraryView>;

export const LauncherContext = createContext<LauncherContextValue | undefined>(undefined);

export function LauncherProvider({ children }: { children: ReactNode }) {
  const launcher = useLauncherState();
  const navigation = useNavigation();
  const settings = useSettingsDraft(launcher.snapshot?.settings);
  const transfers = useTransfers(launcher.setLibrary, launcher.setError, launcher.refresh);
  const preview = useSyncPreview(launcher.setError, launcher.setProgress, launcher.setNotice);
  const deletion = useGameDeletion(launcher.setLibrary, launcher.setError, launcher.setNotice);
  const libraryView = useLibraryView(launcher.library);

  return (
    <LauncherContext.Provider
      value={{
        ...launcher,
        ...navigation,
        ...settings,
        ...transfers,
        ...preview,
        ...deletion,
        ...libraryView,
      }}
    >
      {children}
    </LauncherContext.Provider>
  );
}
