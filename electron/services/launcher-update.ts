import type { AppUpdater } from 'electron-updater';
import type { LauncherUpdate } from '../../shared/types';

// No timers, background downloads, or installation on ordinary application exit.
export class LauncherUpdateService {
  state: LauncherUpdate = { status: 'idle' };
  private checking = false;
  private installing = false;
  constructor(
    private updater: Pick<
      AppUpdater,
      | 'autoDownload'
      | 'autoInstallOnAppQuit'
      | 'allowPrerelease'
      | 'checkForUpdates'
      | 'downloadUpdate'
      | 'quitAndInstall'
      | 'on'
    >,
    private changed: (state: LauncherUpdate) => void,
    private assertIdle: () => void,
    private install: (action: () => void) => void,
  ) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.on('update-available', (info) => {
      if (this.state.status === 'idle') this.publish({ status: 'available', version: info.version });
    });
    updater.on('error', () => {
      // Check failures remain silent; only an explicitly requested install reports errors.
      if (this.installing) {
        this.installing = false;
        this.publish({ ...this.state, status: 'ready', error: 'Could not install update. Try again later.' });
      }
    });
  }
  private publish(state: LauncherUpdate) {
    this.state = state;
    this.changed(state);
  }
  async check() {
    if (this.checking || this.state.status !== 'idle') return;
    this.checking = true;
    try {
      await this.updater.checkForUpdates();
    } catch {
      // Offline, missing repository/releases, and rate limits must not disturb startup.
    } finally {
      this.checking = false;
    }
  }
  later() {
    if (this.state.status === 'available' || this.state.status === 'ready')
      this.publish({ ...this.state, hidden: true });
  }
  async confirm() {
    if (!['available', 'ready'].includes(this.state.status)) return;
    this.assertIdle();
    const version = this.state.version;
    if (this.state.status === 'available') {
      this.publish({ status: 'downloading', version });
      try {
        await this.updater.downloadUpdate();
      } catch {
        this.publish({ status: 'available', version, error: 'Update download failed. Try again later.' });
        return;
      }
      this.publish({ status: 'ready', version });
    }
    // Gameplay/transfers may have started while downloading. Keep the update cached.
    try {
      this.assertIdle();
    } catch {
      return;
    }
    this.installing = true;
    try {
      this.install(() => this.updater.quitAndInstall(false, true));
    } catch (error) {
      this.installing = false;
      throw error;
    }
  }
}
