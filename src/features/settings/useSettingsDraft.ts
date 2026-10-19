import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../shared/types';
import { api } from '../../lib/launcher-api';

export function useSettingsDraft(settings: Settings | undefined) {
  const [draft, setDraft] = useState<Settings>();
  const previous = useRef<Settings | undefined>(undefined);

  useEffect(() => {
    if (!settings) return;
    const baseline = previous.current;
    previous.current = settings;
    setDraft((current) => {
      if (!current || !baseline) return settings;
      // Refresh untouched fields while retaining edits made since the last snapshot.
      const next = { ...current };
      for (const key of Object.keys(settings) as (keyof Settings)[]) {
        if (JSON.stringify(current[key]) === JSON.stringify(baseline[key])) {
          Object.assign(next, { [key]: settings[key] });
        }
      }
      return next;
    });
  }, [settings]);

  const settingsChanged = !!draft && JSON.stringify(draft) !== JSON.stringify(settings);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function pickSetting(key: keyof Settings, kind: 'directory' | 'executable') {
    const value = await api?.pick(kind);
    if (value) setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function addDirectory() {
    const directory = await api?.pick('directory');
    if (directory)
      setDraft((current) =>
        current
          ? {
              ...current,
              gameDirectories: [...new Set([...current.gameDirectories, directory])],
            }
          : current,
      );
  }

  async function savePreferences() {
    if (!api || !draft) return;
    const saved = await api.saveSettings(draft);
    previous.current = saved;
    setDraft(saved);
  }

  return { draft, settingsChanged, update, pickSetting, addDirectory, savePreferences };
}
