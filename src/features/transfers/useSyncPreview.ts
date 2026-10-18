import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import type { Progress, SyncPlan, SyncRequest } from '../../../shared/types';
import { api } from '../../lib/launcher-api';
export function useSyncPreview(
  setError: Dispatch<SetStateAction<string>>,
  setProgress: Dispatch<SetStateAction<Progress | undefined>>,
  setNotice: Dispatch<SetStateAction<string>>,
) {
  const [plan, setPlan] = useState<SyncPlan>();
  const [preparingTransfer, setPreparingTransfer] = useState(false);
  async function preview(request: SyncRequest) {
    if (!api || preparingTransfer) return;
    setPreparingTransfer(true);
    setError('');
    setProgress(undefined);
    try {
      setPlan(await api.planSync(request));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparingTransfer(false);
    }
  }
  async function cancelPreview() {
    if (plan && api) await api.cancelPlan(plan.id);
    setPlan(undefined);
  }
  async function enqueuePlan(current: SyncPlan) {
    setPlan(undefined);
    try {
      await api!.enqueueSync(current.id, true);
      setNotice('Added to downloads');
    } catch (error) {
      setError((error as Error).message);
    }
  }

  return { plan, preparingTransfer, preview, cancelPreview, enqueuePlan };
}
