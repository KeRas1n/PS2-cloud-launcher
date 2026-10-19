# Third-party components

PS2 Cloud Launcher is independent of Sony, PCSX2, MEGA, and Rclone.

- Electron and Chromium are included in desktop distributions. Electron's MIT license and Chromium's `LICENSES.chromium.html` accompany the runtime. Source: https://github.com/electron/electron
- React, React DOM, Lucide, Zod, and their runtime dependencies retain their upstream licenses. Their package license files are retained inside `resources/app.asar/node_modules/`. Source repositories are identified in each package's `package.json`.
- `7zip-bin` includes the 7-Zip command-line extraction tool by Igor Pavlov. 7-Zip is licensed under the GNU LGPL, with parts under the BSD 3-clause license and unRAR restrictions. License information: https://www.7-zip.org/license.txt. Source code: https://www.7-zip.org/download.html. Wrapper/distribution source: https://github.com/develar/7zip-bin. The launcher uses this tool as a separate process; no extraction tool code is linked into launcher code.
- PCSX2 is downloaded from its official GitHub releases when requested; it is not included in the launcher installer. PCSX2 retains its upstream licenses, including GPL-3.0. Source and license: https://github.com/PCSX2/pcsx2
- Rclone v1.75.2 is included in Windows/Linux x64 installers as a private cloud component. Official archives are verified against the upstream SHA-256 checksum during packaging. Its executable, version and MIT license (`COPYING`) are included in `resources/cloud/`. Development builds can also download an official release automatically on connection. Source and license: https://github.com/rclone/rclone and https://rclone.org/licence/

BIOS files, games, and game cover images are not distributed with this application. Imported content belongs to its respective owners.
