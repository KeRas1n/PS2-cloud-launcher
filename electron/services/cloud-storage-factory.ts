import type { CloudProvider, Progress } from '../../shared/types';
import type { CloudStorage } from './cloud-storage';
import { MegaCloudStorage } from './mega-cloud-storage';
import { RcloneService } from './rclone';
import type { SettingsStore } from './settings';

type AdapterFactory = (
  store: SettingsStore,
  emit: (progress: Progress) => void,
  bundledPath?: string,
) => CloudStorage;
const adapters: Record<CloudProvider, AdapterFactory> = {
  mega: (store, emit, bundledPath) => new MegaCloudStorage(new RcloneService(store, emit, bundledPath)),
};

export function createCloudStorage(
  store: SettingsStore,
  emit: (progress: Progress) => void,
  bundledPath?: string,
): CloudStorage {
  const factory = adapters[store.value.cloudProvider];
  if (!factory) throw new Error('Unsupported cloud storage provider.');
  return factory(store, emit, bundledPath);
}
