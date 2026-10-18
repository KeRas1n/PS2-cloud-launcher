import { useState } from 'react';
import type { Page, SettingsTab } from './navigation';
export function useNavigation() {
  const [page, setPage] = useState<Page>('Games');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('Games');
  function goToSettings(tab: SettingsTab) {
    setSettingsTab(tab);
    setPage('Settings');
  }

  return { page, setPage, settingsTab, setSettingsTab, goToSettings };
}
