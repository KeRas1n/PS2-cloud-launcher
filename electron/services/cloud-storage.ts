import type {
  CloudProvider,
  CloudStatus,
  CloudCredentials,
  Progress,
  Settings,
  SyncKind,
} from '../../shared/types';
import type { SettingsStore } from './settings';

export interface CloudFile {
  path: string;
  size: number;
  modified: string;
  isDirectory: boolean;
}
export interface CopyOptions {
  backupDirectory?: string;
  ignoreTimes?: boolean;
  inPlace?: boolean;
  retries?: number;
  lowLevelRetries?: number;
}
export type TransferProgress = (progress: Progress) => void;

// Adapters interpret slash-joined locations returned by remote(); local paths stay absolute.
// Copies merge without deletion and preserve replaced files in backupDirectory.
export interface CloudStorage {
  readonly provider: CloudProvider;
  status(): Promise<CloudStatus>;
  connect(credentials?: CloudCredentials): Promise<CloudStatus>;
  install(): Promise<void>;
  remote(kind?: SyncKind): string;
  list(location: string): Promise<CloudFile[]>;
  ensureFolders(): Promise<void>;
  copyFile(
    source: string,
    destination: string,
    options?: CopyOptions,
    progress?: TransferProgress,
  ): Promise<void>;
  copyDirectory(
    source: string,
    destination: string,
    options?: CopyOptions,
    progress?: TransferProgress,
  ): Promise<void>;
  // Commit/rollback and cleanup must finish even after transfer cancellation.
  commitMove(source: string, destination: string): Promise<void>;
  commitDelete(location: string): Promise<void>;
  createTransferClient(
    settings: Settings,
    directory: string,
  ): Promise<{ client: CloudStorage; store: SettingsStore }>;
  setCancellation(signal: AbortSignal): void;
  transferLogDirectory(): Promise<string>;
  resetSession(): Promise<void>;
  dispose(): void;
  close(): Promise<void>;
}
