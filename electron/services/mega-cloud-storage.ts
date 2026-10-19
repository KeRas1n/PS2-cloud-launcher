import { z } from 'zod';
import type { MegaCredentials, Settings, SyncKind } from '../../shared/types';
import type { CloudStorage, CopyOptions, TransferProgress } from './cloud-storage';
import { RcloneService } from './rclone';

const credentialsSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(1).max(4096),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict()
  .optional();

// MEGA's transport, credentials, session reuse and transfer flags stay behind this adapter.
export class MegaCloudStorage implements CloudStorage {
  readonly provider = 'mega' as const;
  constructor(private readonly transport: RcloneService) {}
  status() {
    return this.transport.status();
  }
  async connect(credentials?: MegaCredentials) {
    return this.transport.connect(credentialsSchema.parse(credentials));
  }
  install() {
    return this.transport.install();
  }
  remote(kind?: SyncKind) {
    return this.transport.remote(kind);
  }
  async list(location: string) {
    return (await this.transport.list(location)).map((file) => ({
      path: file.Path,
      size: file.Size,
      modified: file.ModTime,
      isDirectory: file.IsDir,
    }));
  }
  ensureFolders() {
    return this.transport.ensureFolders();
  }
  private options(options: CopyOptions) {
    return [
      ...(options.backupDirectory ? ['--backup-dir', options.backupDirectory] : []),
      ...(options.ignoreTimes ? ['--ignore-times'] : []),
      ...(options.inPlace ? ['--inplace'] : []),
      ...(options.retries !== undefined ? ['--retries', String(options.retries)] : []),
      ...(options.lowLevelRetries !== undefined
        ? ['--low-level-retries', String(options.lowLevelRetries)]
        : []),
    ];
  }
  async copyFile(
    source: string,
    destination: string,
    options: CopyOptions = {},
    progress?: TransferProgress,
  ) {
    await this.transport.call(['copyto', source, destination, ...this.options(options)], progress);
  }
  async copyDirectory(
    source: string,
    destination: string,
    options: CopyOptions = {},
    progress?: TransferProgress,
  ) {
    await this.transport.call(['copy', source, destination, ...this.options(options)], progress);
  }
  async commitMove(source: string, destination: string) {
    await this.transport.commit(['moveto', source, destination]);
  }
  async commitDelete(location: string) {
    await this.transport.commit(['deletefile', location]);
  }
  async createTransferClient(settings: Settings, directory: string) {
    const scoped = await this.transport.createTransferClient(settings, directory);
    return { store: scoped.store, client: new MegaCloudStorage(scoped.client) };
  }
  setCancellation(signal: AbortSignal) {
    this.transport.setCancellation(signal);
  }
  transferLogDirectory() {
    return this.transport.transferLogDirectory();
  }
  resetSession() {
    return this.transport.resetSession();
  }
  dispose() {
    this.transport.dispose();
  }
  close() {
    return this.transport.close();
  }
}
