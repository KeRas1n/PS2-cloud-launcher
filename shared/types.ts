// Add future provider credentials here; CloudProvider and CloudCredentials follow automatically.
export interface CloudCredentialsByProvider {
  mega: MegaCredentials;
}
export type CloudProvider = keyof CloudCredentialsByProvider;
export type CloudCredentials = CloudCredentialsByProvider[CloudProvider];
export interface CloudProfile {
  remote: string;
  cloudRoot: string;
}
export interface MegaCredentials {
  email: string;
  password: string;
  code?: string;
}
export interface Settings {
  cloudProvider: CloudProvider;
  cloudProfiles: Partial<Record<CloudProvider, CloudProfile>>;
  gameDirectories: string[];
  downloadDirectory: string;
  emulatorRoot: string;
  pcsx2Path: string;
  dataDirectory: string;
  biosDirectory: string;
  memcardsDirectory: string;
  saveStatesDirectory: string;
  rclonePath: string;
  rcloneConfig: string;
  remote: string;
  cloudRoot: string;
  fullscreen: boolean;
  autoSyncSaves: boolean;
}
export type GameState = 'Local Only' | 'In Cloud' | 'Cloud Only';
export interface Game {
  id: string;
  title: string;
  name: string;
  size: number;
  state: GameState;
  localPath?: string;
  cloudPath?: string;
  cover?: string;
}
export interface GameDeletion {
  token: string;
  gameId: string;
  title: string;
  localPath: string;
  cloud: 'stored' | 'missing' | 'unknown';
}
export interface EmulatorStatus {
  profile?: EmulatorProfile;
  installed: boolean;
  path?: string;
  version?: string;
  running: boolean;
  managed: boolean;
}
export interface BiosImage {
  name: string;
  version: string;
  region: string;
}
export interface EmulatorProfile {
  directory: string;
  prepared: boolean;
  ready: boolean;
  bios: BiosImage[];
  selectedBios?: string;
}
export interface CloudStatus {
  installed: boolean;
  version?: string;
  connected: boolean;
  remotes: string[];
  error?: string;
}
export interface Library {
  games: Game[];
  warnings: string[];
  cloudChecked: boolean;
}
export type SyncKind = 'Games' | 'Memcards' | 'SaveStates';
export type Direction = 'upload' | 'download';
export interface SyncRequest {
  kind: SyncKind;
  direction: Direction;
  gameId?: string;
}
export interface SyncFile {
  path: string;
  size: number;
  replaces: boolean;
  previousSize?: number;
}
export interface SyncPlan {
  id: string;
  kind: SyncKind;
  direction: Direction;
  files: SyncFile[];
  bytes: number;
  backupLocation: string;
}
export type TransferState = 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
export interface Transfer {
  id: string;
  title: string;
  kind: SyncKind | 'BIOS';
  direction: Direction;
  provider: CloudProvider;
  gameId?: string;
  state: TransferState;
  bytes: number;
  totalBytes: number;
  speed: number;
  message: string;
  error?: string;
}
export interface Progress {
  operation: string;
  message: string;
  percent?: number;
  bytes?: number;
  totalBytes?: number;
  speed?: number;
  averageSpeed?: number;
  emulatorRunning?: boolean;
  saveSyncRunning?: boolean;
}
export interface Snapshot {
  settings: Settings;
  emulator: EmulatorStatus;
  cloud: CloudStatus;
}
export interface LauncherUpdate {
  status: 'idle' | 'available' | 'downloading' | 'ready';
  version?: string;
  hidden?: boolean;
  error?: string;
}
export interface LauncherAPI {
  launcherUpdate(): Promise<LauncherUpdate>;
  confirmLauncherUpdate(): Promise<void>;
  deferLauncherUpdate(): Promise<void>;
  onLauncherUpdate(callback: (state: LauncherUpdate) => void): () => void;
  snapshot(): Promise<Snapshot>;
  saveSettings(settings: Settings): Promise<Settings>;
  resetLauncher(confirmed: boolean): Promise<void>;
  pick(kind: 'directory' | 'executable' | 'bios' | 'cover'): Promise<string | null>;
  library(): Promise<Library>;
  installEmulator(): Promise<EmulatorStatus>;
  prepareEmulator(): Promise<void>;
  selectBios(name: string): Promise<void>;
  openEmulator(gameId?: string): Promise<void>;
  importBios(): Promise<number>;
  setCover(gameId: string): Promise<void>;
  prepareDeleteGame(gameId: string): Promise<GameDeletion>;
  deleteGame(token: string, confirmed: boolean): Promise<void>;
  installCloudComponent(): Promise<void>;
  connectCloud(credentials?: CloudCredentials): Promise<CloudStatus>;
  syncSaves(): Promise<void>;
  openTransferLogs(): Promise<void>;
  planSync(request: SyncRequest): Promise<SyncPlan>;
  executeSync(id: string, confirmed: boolean): Promise<void>;
  enqueueSync(id: string, confirmed: boolean): Promise<Transfer>;
  transfers(): Promise<Transfer[]>;
  cancelTransfer(id: string): Promise<void>;
  onTransfers(callback: (transfers: Transfer[]) => void): () => void;
  cancelPlan(id: string): Promise<void>;
  openLink(link: 'pcsx2' | 'rclone' | 'mega'): Promise<void>;
  onProgress(callback: (progress: Progress) => void): () => void;
}
