import { useEffect, useState } from 'react';
import type { Library, Progress, Snapshot } from '../../shared/types';
import { api } from '../lib/launcher-api';
export function useLauncherState() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [library, setLibrary] = useState<Library>({ games: [], warnings: [], cloudChecked: false });
  const [busy, setBusy] = useState('');
  const [saveSyncRunning, setSaveSyncRunning] = useState(false);
  const [booting, setBooting] = useState(true);
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function refresh(scan = true) {
    if (!api) return;
    const value = await api.snapshot();
    setSnapshot(value);

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
  const disabled = !!busy || saveSyncRunning || booting || !api;
  const connected = !!snapshot?.cloud.connected;
  const provider = snapshot?.settings.cloudProvider ?? 'mega';
  const providerName = 'MEGA';
  const emulator = snapshot?.emulator;

  return {
    snapshot,
    library,
    setLibrary,
    busy,
    saveSyncRunning,
    booting,
    progress,
    setProgress,
    error,
    setError,
    notice,
    setNotice,
    refresh,
    act,
    disabled,
    connected,
    provider,
    providerName,
    emulator,
  };
}
