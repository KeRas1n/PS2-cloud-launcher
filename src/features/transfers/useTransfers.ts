import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Library, Transfer } from '../../../shared/types';
import { api } from '../../lib/launcher-api';
import { activeTransfer } from './transfer-state';
export function useTransfers(
  setLibrary: Dispatch<SetStateAction<Library>>,
  setError: Dispatch<SetStateAction<string>>,
  refresh: (scan?: boolean) => Promise<void>,
) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const terminalTransfers = useRef(new Set<string>());
  useEffect(() => {
    if (!api) return;
    const bridge = api;
    const receive = (items: Transfer[]) => {
      setTransfers(items);
      const finished = items.filter(
        (item) => !activeTransfer(item) && !terminalTransfers.current.has(item.id),
      );
      for (const item of finished) terminalTransfers.current.add(item.id);
      if (finished.some((item) => item.kind === 'BIOS' && item.direction === 'download'))
        void refresh(false).catch(() => {});
      if (finished.length)
        void bridge
          .library()
          .then(setLibrary)
          .catch(() => {});
    };
    const unsubscribe = api.onTransfers(receive);
    void api
      .transfers()
      .then(receive)
      .catch((e) => setError(e.message));
    return unsubscribe;
  }, []);
  async function cancelTransfer(id: string) {
    try {
      await api!.cancelTransfer(id);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const activeTransfers = transfers.filter(activeTransfer);

  return { transfers, cancelTransfer, activeTransfers };
}
