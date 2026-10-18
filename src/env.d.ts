import type { LauncherAPI } from '../shared/types';
declare global {
  interface Window {
    launcher?: LauncherAPI;
  }
}
