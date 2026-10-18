import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function registerCoverProtocol(userData: string) {
  protocol.handle('launcher-cover', (request) => {
    const url = new URL(request.url),
      match = /^\/([a-f0-9]{64})$/.exec(url.pathname);
    if (url.hostname !== 'cover' || !match) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(userData, 'covers', `${match[1]}.img`)).href);
  });
}
