import { useEffect, useState } from 'react';
import { useLauncher } from '../app/useLauncher';
import type { LauncherUpdate } from '../../shared/types';
import { api } from '../lib/launcher-api';

export function LauncherUpdateNotice() {
  const { setError } = useLauncher();
  const [update, setUpdate] = useState<LauncherUpdate>({ status: 'idle' });
  useEffect(() => {
    let changed = false;
    const unsubscribe = api?.onLauncherUpdate((state) => {
      changed = true;
      setUpdate(state);
    });
    void api
      ?.launcherUpdate()
      .then((state) => {
        if (!changed) setUpdate(state);
      })
      .catch(() => {});
    return () => {
      changed = true;
      unsubscribe?.();
    };
  }, []);
  const confirmUpdate = () => {
    void api?.confirmLauncherUpdate().catch((error: Error) => setError(error.message));
  };

  return (
    <>
      {update.status !== 'idle' && !update.hidden && (
        <div className="sidebar-update" role="status">
          <span>
            {update.status === 'downloading'
              ? 'Downloading launcher update…'
              : update.status === 'ready'
                ? `Update ${update.version} ready. Close PCSX2 and finish transfers to install.`
                : `Launcher ${update.version} available. Updating restarts the launcher.`}
            {update.error && <span> {update.error}</span>}
          </span>
          {update.status !== 'downloading' && (
            <>
              <button onClick={confirmUpdate}>Update</button>
              <button
                onClick={() =>
                  void api?.deferLauncherUpdate().catch((error: Error) => setError(error.message))
                }
              >
                Later
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
