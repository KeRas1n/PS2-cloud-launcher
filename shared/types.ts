export interface Settings {
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
export interface Progress {
  operation: string;
  message: string;
  percent?: number;
  bytes?: number;
  totalBytes?: number;
  speed?: number;
  emulatorRunning?: boolean;
}
export interface Snapshot {
  settings: Settings;
  emulator: EmulatorStatus;
  cloud: CloudStatus;
}
export interface LauncherAPI {
  snapshot(): Promise<Snapshot>;
  saveSettings(settings: Settings): Promise<Settings>;
  pick(kind: 'directory' | 'executable' | 'bios' | 'cover'): Promise<string | null>;
  library(): Promise<Library>;
  installEmulator(): Promise<EmulatorStatus>;
  prepareEmulator(): Promise<void>;
  selectBios(name: string): Promise<void>;
  openEmulator(gameId?: string): Promise<void>;
  importBios(): Promise<number>;
  setCover(gameId: string): Promise<void>;
  installRclone(): Promise<void>;
  connectCloud(): Promise<CloudStatus>;
  planSync(request: SyncRequest): Promise<SyncPlan>;
  executeSync(id: string, confirmed: boolean): Promise<void>;
  cancelPlan(id: string): Promise<void>;
  openLink(link: 'pcsx2' | 'rclone' | 'dropbox'): Promise<void>;
  onProgress(callback: (progress: Progress) => void): () => void;
}
