import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Direction, Progress } from '../../shared/types';
import type { CloudStorage } from './cloud-storage';
import { SettingsStore } from './settings';
import { TransferQueue } from './transfer-queue';
import { listBios, readBios } from './bios';
import { exists, safeRelative } from './files';

// BIOS merges only missing files. Existing local and cloud images are never replaced.
export class BiosSyncService {
  constructor(
    private store: SettingsStore,
    private cloud: CloudStorage,
    private queue: TransferQueue,
    private downloaded: () => Promise<void> = async () => {},
  ) {}

  async enqueue(direction: Direction) {
    const settings = structuredClone(this.store.value);
    const key = `bios:${settings.rcloneConfig}:${settings.remote}:${settings.cloudRoot}:${settings.biosDirectory}:${direction}`;
    if (this.queue.has(key)) return;
    const directory = path.join(this.store.userData, 'transfer-staging', randomUUID());
    let client: CloudStorage | undefined;
    const cleanup = async () => {
      try {
        await client?.close();
      } finally {
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    };
    try {
      // Capture credentials now so queued work cannot switch MEGA accounts later.
      client = (await this.cloud.createTransferClient(settings, directory)).client;
      const transferClient = client;
      return this.queue.add(
        { title: 'BIOS', kind: 'BIOS', direction, provider: 'mega', totalBytes: 0 },
        [key],
        async (signal, progress) => {
          transferClient.setCancellation(signal);
          await transferClient.ensureFolders();
          const remote = transferClient.remote('BIOS');
          const cloudFiles = (await transferClient.list(remote)).filter((file) => {
            safeRelative(file.path);
            return !file.isDirectory && !file.path.includes('/') && !/[\r\n]/.test(file.path);
          });
          await fs.mkdir(settings.biosDirectory, { recursive: true });
          const local = await listBios(settings.biosDirectory);
          const files =
            direction === 'upload'
              ? await Promise.all(
                  local
                    .filter(
                      (image) =>
                        !cloudFiles.some((file) => file.path.toLowerCase() === image.name.toLowerCase()),
                    )
                    .map(async (image) => ({
                      path: image.name,
                      size: (await fs.stat(path.join(settings.biosDirectory, image.name))).size,
                    })),
                )
              : cloudFiles.filter((file) => file.size >= 512 * 1024 && file.size <= 8 * 1024 * 1024);
          const pending = [];
          for (const file of files) {
            if (direction === 'download' && (await exists(path.join(settings.biosDirectory, file.path))))
              continue;
            pending.push(file);
          }
          const totalBytes = pending.reduce((sum, file) => sum + file.size, 0);
          let bytes = 0;
          for (const file of pending) {
            signal.throwIfAborted();
            const localPath = path.join(settings.biosDirectory, file.path);
            const cloudPath = `${remote}/${file.path}`;
            const report = (p: Progress) =>
              progress({ ...p, bytes: bytes + Math.min(p.bytes ?? 0, file.size), totalBytes });
            progress({ operation: 'bios', message: file.path, bytes, totalBytes });
            if (direction === 'upload') {
              if (!(await readBios(localPath))) throw new Error(`BIOS is missing or invalid: ${file.path}`);
              await transferClient.copyFile(localPath, cloudPath, {}, report);
            } else {
              const temporary = path.join(directory, 'download.bin');
              await transferClient.copyFile(cloudPath, temporary, {}, report);
              signal.throwIfAborted();
              if (!(await readBios(temporary))) throw new Error(`Invalid BIOS in MEGA: ${file.path}`);
              await fs.copyFile(temporary, localPath, constants.COPYFILE_EXCL);
              await fs.unlink(temporary);
            }
            bytes += file.size;
            progress({ operation: 'bios', message: file.path, bytes, totalBytes });
          }
          if (direction === 'download' && pending.length) await this.downloaded();
        },
        cleanup,
      );
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}
