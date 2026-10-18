# PS2 Cloud Launcher

A local-first Electron launcher for Windows and Linux. React, TypeScript and Vite power a responsive dark library; Electron services handle PCSX2, files and Rclone. All application text is English. There is no backend, subscription, bundled BIOS or bundled game.

## Development

Use Node.js 22 or newer and npm on Windows x86-64 or Linux x86-64.

```sh
npm ci
npm run dev
```

The desktop window opens against Vite at `http://127.0.0.1:5173`. Open the Electron application, not the Vite URL alone: browsers do not have the privileged preload API. Main-process changes require restarting `npm run dev`; renderer changes use hot reload.

```sh
npm test                 # service tests; no account or network needed
npm run build            # strict TypeScript checks and production build
npm run test:smoke       # hidden Electron UI and IPC tests; run after build
npm run test:integration # official downloads + real Rclone local-backend transfers
npm run dist             # native installers for the current operating system
```

On headless Linux, run the smoke test through `xvfb-run --auto-servernum npm run test:smoke`. Install Electron's GTK, NSS and graphics dependencies. PCSX2 AppImage also needs the dependencies documented by [PCSX2 Linux troubleshooting](https://pcsx2.net/docs/troubleshooting/linux/). Packaging produces Windows NSIS and portable `.exe`, or Linux AppImage and `.deb`, in `release/`.

Integration tests are opt-in: they download official PCSX2 and Rclone binaries into unique `test-results/integration-*` directories. Their cloud fixture uses Rclone's real local alias backend, not a Dropbox account. Text `.iso` fixtures are not playable games. Tests never authorize an account or transfer personal data. Test screenshots and credentials are ignored by Git.

## First launch

1. **Emulator:** select **Install PCSX2**. The launcher resolves the latest non-prerelease from `PCSX2/pcsx2` on GitHub and selects the Windows portable archive or Linux AppImage. Automatic installation requires x86-64. You may select an existing executable in Settings instead.
2. Import an uncompressed BIOS dumped from your own console in **Emulator**. Its ROM directory is checked before importing, and the launcher selects it automatically. Choose another imported BIOS from the launcher dropdown if needed. The launcher never provides BIOS or game downloads. **Prepare emulator** can create a profile in advance; game launch also prepares it automatically. No PCSX2 setup wizard is needed.
3. **Settings:** add folders containing your own `.iso` and `.chd` images. Save preferences. Scanning is recursive, skips hidden entries and symbolic links, and includes the game download directory automatically.
4. **Cloud:** install Rclone with the supplied button, or choose an existing executable. Click **Connect Dropbox** and authorize Rclone in your browser. Rclone uses its built-in Dropbox OAuth client; you supply your own account, without developer API keys or a hosted service.
5. Use game-card actions for disc images, and the four manual save buttons for memory cards and save states. Every transfer gets a review dialog before it begins.

## Emulator storage and existing installations

The launcher first tries `emulator/` alongside its executable (alongside the outer AppImage or portable EXE when applicable). If that directory cannot be written, it uses `emulator/` inside Electron's per-user data directory. Settings can override the installation and data paths.

```text
emulator/
  installed.json
  versions/<release>-<unique-id>/  # replaceable official binaries
  data/                          # persistent PCSX2 portable-style data
    bios/
    memcards/
    sstates/
    PCSX2/inis/PCSX2.ini          # actual PCSX2 2.x profile for -datapath data/
```

Updates stage and extract a new version, then switch the managed executable. They do not merge release files into your existing data or remove old versions. Previous versions remain available for rollback by selecting their executable in Settings. GitHub asset SHA-256 digests are verified when supplied; Rclone downloads always verify the official release SHA-256 checksum. Downloads use an HTTPS host allowlist.

PCSX2 starts with [`-datapath <parent>`](https://pcsx2.net/docs/advanced/cli/). PCSX2 2.8.2 appends `PCSX2/` to that parent, so the actual profile is `<parent>/PCSX2/inis/PCSX2.ini`. The Emulator page displays the actual profile path. For an existing conventional profile named `PCSX2`, select its parent in Settings, plus existing BIOS, memory-card and state directories. An external `portable.txt`/`portable.ini` overrides `-datapath`; existing initialized portable profiles are supported, while a fresh external portable profile should be replaced with a managed installation for automatic initialization. Changing paths does **not** move files automatically.

The launcher obtains hardware-appropriate defaults through PCSX2's `-testconfig` mode in an isolated fresh profile, then caches them per executable. This mode exits before constructing the wizard or main window. Missing defaults are merged into the real profile, existing controller/graphics settings are retained, and the original INI gets a unique `PCSX2.ini.launcher-backup-*` before a change. The launcher sets the real folder paths, marks setup complete, disables automatic update/shutdown prompts and consoles, and selects a structurally valid imported BIOS. Games start with `-nogui` and the configured fullscreen flag; only the game display is shown during normal play. Fresh profiles include PCSX2's default keyboard controls. Invalid/missing BIOS and missing disc files are reported in the launcher before spawning gameplay. Upstream PCSX2 may still display native fatal error dialogs for hardware, driver, or corrupt-disc failures; stock CLI does not suppress every native error dialog.

If older launcher versions let the wizard populate `<parent>/PCSX2/memcards`, `sstates`, or `bios` while the configured default folders remained empty, preparation preserves those populated directories by selecting their paths. Files are not moved or removed. Custom or populated configured save folders are not replaced. Do not leave another PCSX2 instance open while changing profiles or synchronizing. The launcher blocks transfers while its own PCSX2 child runs; independently started processes cannot be reliably detected everywhere.

PCSX2 detection checks the configured path, managed manifest, PATH, Windows `Program Files/PCSX2`, and Linux `/usr/bin/pcsx2`. Choose other installations manually. Flatpak launch wrappers are not automatically managed. External installations report `-version` where supported. Updating an external installation creates a managed copy; it does not overwrite that external installation.

## Dropbox and save safety

The default remote is `ps2-dropbox`; the default root is `PS2Cloud`. Change both in Settings. For an existing Rclone configuration, enter its absolute configuration path before connecting. New configurations are stored in the launcher user-data `credentials/rclone.conf`; credentials never enter renderer code or preferences JSON. Linux configuration permissions are restricted to the current user. On Windows, keep the configuration in your private user profile; the launcher inherits its filesystem ACLs.

```text
PS2Cloud/
  Games/       # .iso and .chd
  Memcards/    # memory cards, including folder cards
  SaveStates/  # save states
  Backups/     # prior cloud files organized by transfer ID and category
```

Rclone opens Dropbox OAuth in your default browser. Approve it there and leave the launcher open. Reconnect uses the existing remote without displaying tokens. Network errors, denied access and missing dependencies appear in the UI. If OAuth fails, use the official [Rclone Dropbox guide](https://rclone.org/dropbox/), then select the resulting configuration and remote in Settings. The launcher supports unencrypted configurations and configurations already usable noninteractively by Rclone; interactive config-password entry is not implemented.

Transfers use **`rclone copyto`, never `rclone sync` or delete**. Each preview lists source sizes, destination sizes and replacements. Existing destinations are conservatively treated as conflicts, including same-size files. A confirmed transfer rechecks source/destination metadata and settings; a stale preview must be reviewed again. Missing source files never remove destination files. Symbolic links in local destination paths and cloud path traversal are rejected.

Before an existing file is replaced, Rclone's `--backup-dir` preserves it. Upload backups remain in Dropbox under `Backups/<transfer-id>/<category>/`; download backups stay in the launcher's user-data `backups/<transfer-id>/<category>/`. Nested paths are preserved. A failed transfer may leave completed files and their backups; refresh and review a new preview before retrying. Backups are retained until you remove them yourself. Ensure sufficient storage for both originals and replacements.

Metadata checks prevent common stale-preview mistakes, but cannot lock remote clients or independently running emulators. Close PCSX2 and avoid modifying the same files on another device during transfers. Use compatible PCSX2 versions across devices for save states.

## Library behavior and artwork

- **Local Only:** Play locally or **Upload to Cloud**.
- **In Cloud:** available on disk and Dropbox; **Play**.
- **Cloud Only:** **Download** to the configured directory, then **Play** after automatic refresh.

Matching uses the complete filename, case-insensitively, including extension. It does not prove disc contents match. Distinct discs must have distinct names; duplicate names produce notices. Case conflicts are blocked before transfers. Without a successful cloud listing, local entries show **Cloud unchecked** rather than claiming verified absence. Refresh after external filesystem changes.

Import PNG, JPEG or WebP covers using the image button on a game cover. Artwork is stored locally under `covers/` and served through a restricted Electron protocol. Games without imported art get a styled title cover. There is no unlicensed artwork scraping or metadata service.

## Architecture

```text
shared/types.ts                 Typed, narrow renderer API
electron/main.ts                IPC validation, dialogs, window security
electron/preload.ts             contextBridge API; no raw IPC exposure
electron/services/settings.ts   Validated, atomic preferences
electron/services/pcsx2.ts      Detection, release installation, process lifecycle
electron/services/games.ts      Recursive discovery and cloud comparison
electron/services/rclone.ts     Official installation, OAuth, remote listing, progress
electron/services/sync.ts       Conflict plans, stale checks, copy-only execution
src/App.tsx                     Four pages, notifications and transfer review
src/styles.css                  Responsive dark interface and reduced-motion support
tests/services.test.ts          Service regression tests
scripts/smoke.cjs               Real Electron IPC and UI smoke test
scripts/integration.cjs         Official binary / real Rclone integration
```

The renderer has no Node.js integration. Context isolation, sandboxing, CSP, sender validation, schema-validated IPC, denied permissions and blocked arbitrary navigation are enabled. Processes run with argument arrays and no shell. External links are restricted to fixed documentation URLs. No credentials are logged by the OAuth flow. Keep configuration files, user data, emulator files and `.env` files out of Git.

## Releases

GitHub Actions tests and builds Windows and Linux on native runners. Tags and manual workflow runs also execute official-binary and real Rclone integration tests on both platforms. A `v*` tag creates a **draft** GitHub release with Windows installers and Linux packages after both builds pass. No signing certificate is configured; configure signing before distributing production releases. Normal pushes and pull requests upload build artifacts without publishing a release.

The launcher requires a real Dropbox authorization for end-to-end Dropbox verification and your own BIOS/disc for gameplay testing. The repository does not contain either. No automatic background save sync, deletion mirroring, automatic artwork downloads or paid backend is included.

## Troubleshooting

- **GitHub release rate limit:** retry later; anonymous GitHub API limits apply. No GitHub credentials are required.
- **Rclone not found:** install through Cloud, ensure `rclone` is on PATH, or select its absolute executable path.
- **Cloud disconnected:** check the remote/config path, reconnect, and review the reported error. Account quotas and Dropbox permissions still apply.
- **PCSX2 does not launch:** import/select a valid uncompressed BIOS in Emulator, check paths, and review the PCSX2 `logs/emulog.txt` in the displayed profile directory. On Windows, PCSX2 may need the current Visual C++ runtime; see [official setup](https://pcsx2.net/docs/setup/).
- **Existing save not visible:** point Settings at its actual directory and close/reopen PCSX2. An imported external install is not automatically migrated.
- **Invalid preferences file:** repair or rename `settings.json` in Electron user data. Invalid files are not silently overwritten.
- **Windows packaging fails renaming the extracted runtime:** retry with the installed runtime: `npx electron-builder --win --x64 --publish never --config.electronDist=node_modules/electron/dist`. Use a fresh output directory if a previous unpacked application is still running.

MIT license applies to launcher code. PCSX2, Rclone and 7-Zip retain their own licenses; packaging retains dependency license files. This project is not affiliated with Sony, Dropbox, PCSX2 or Rclone.
