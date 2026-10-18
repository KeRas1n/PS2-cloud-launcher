import { dialog } from 'electron';
import type { WindowReference } from '../window';
export function createFilePicker(windows: WindowReference) {
  async function pick(kind: 'directory' | 'executable' | 'bios' | 'cover') {
    const result = await dialog.showOpenDialog(windows.current!, {
      properties: kind === 'directory' ? ['openDirectory', 'createDirectory'] : ['openFile'],
      filters:
        kind === 'cover'
          ? [{ name: 'Cover images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
          : kind === 'bios'
            ? [
                { name: 'BIOS files', extensions: ['bin', 'rom', 'bios'] },
                { name: 'All files', extensions: ['*'] },
              ]
            : [],
    });
    return result.canceled ? null : result.filePaths[0];
  }

  return pick;
}
