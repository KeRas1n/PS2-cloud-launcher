# PS2 Cloud Launcher

A local-first Electron launcher for Windows and Linux. React, TypeScript and Vite power a responsive dark library; Electron services handle PCSX2, files and Rclone. All application text is English. There is no backend, subscription, bundled BIOS or bundled game.

## Development

See [application architecture](docs/architecture.md) for module boundaries, state ownership and verification.

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

On headless Linux, run the smoke test through `xvfb-run --auto-servernum npm run test:smoke`. Install Electron's GTK, NSS and graphics dependencies. Smoke tests prepare the official, checksum-verified Rclone binary when it is missing from `tools/bundled-rclone/`; the first run requires network access. PCSX2 AppImage also needs the dependencies documented by [PCSX2 Linux troubleshooting](https://pcsx2.net/docs/troubleshooting/linux/). Packaging produces Windows NSIS and portable `.exe`, or Linux AppImage and `.deb`, in `release/`.

Integration tests are opt-in: they download official PCSX2 and Rclone binaries into unique `test-results/integration-*` directories. Their cloud fixture uses Rclone's real local alias backend, not a Dropbox account. Text `.iso` fixtures are not playable games. Tests never authorize an account or transfer personal data. Test screenshots and credentials are ignored by Git.

## Launcher updates

Installed Windows NSIS builds and Linux AppImages silently check the public
[`KeRas1n/PS2-cloud-launcher` GitHub Releases](https://github.com/KeRas1n/PS2-cloud-launcher/releases)
once at startup. A small notification offers **Update** or **Later**. **Update**
downloads the release and restarts the launcher to install it. **Later** dismisses
the offer for this session. No download happens before confirmation, and ordinary
exit never installs a cached update. Offline checks and missing releases stay silent.

Close PCSX2 and finish or cancel all queued/running transfers before updating.
If gameplay or another operation starts during download, installation waits for
another **Update** click after that activity finishes. Automatically launched PCSX2
and launcher operations are tracked; independently launched PCSX2 is not detectable
reliably, so close it yourself first. Windows portable EXE and Linux deb packages
remain manual updates; use NSIS or AppImage for automatic updates.

Launcher updates retain settings, credentials, PCSX2 binaries/profile, BIOS, games,
saves, and external paths. Windows update installation overlays application files
without recursively deleting the installation folder, preserving legacy adjacent
`emulator/` data. Bundled Rclone is refreshed with the application; its user config
and custom installations remain in place. Install the first updater-enabled NSIS
build before relying on this behavior; older uninstallers do not have this safeguard.

To release: keep `build.appId` and package `name` stable, bump `package.json`'s
version, commit the updated package and lockfile, and push a matching `vX.Y.Z` tag.
Existing CI builds both platforms and creates a draft GitHub Release containing
installers, `latest.yml`, `latest-linux.yml`, and `.blockmap` files. Publish that
draft when both platform assets are ready. Drafts/prereleases are not offered.
The repository must exist and be public; no GitHub token is embedded in the app.
For a manual build, use `npm run dist -- --publish never` and upload the same files
from `release/`. Initial end-to-end verification needs two published versions:
install the older updater-enabled build, then publish a higher version and verify
**Later**, confirmed update/restart, and retained data on Windows and Linux.

## First launch

1. **Emulator:** select **Install PCSX2**. The launcher resolves the latest non-prerelease from `PCSX2/pcsx2` on GitHub and selects the Windows portable archive or Linux AppImage. Automatic installation requires x86-64. You may select an existing executable in Settings instead.
2. Import an uncompressed BIOS dumped from your own console in **Emulator**. Its ROM directory is checked before importing, and the launcher selects it automatically. Choose another imported BIOS from the launcher dropdown if needed. The launcher never provides BIOS or game downloads. **Prepare emulator** can create a profile in advance; game launch also prepares it automatically. No PCSX2 setup wizard is needed.
3. **Settings:** add folders containing your own PCSX2 images. Supported extensions: `.iso`, `.bin`, `.img`, `.mdf`, `.gz`, `.cso`, `.zso`, `.chd`, `.elf`, `.dump`, `.gs`, `.gs.xz`, `.gs.zst` (disc images, homebrew and diagnostic dumps, matching [PCSX2's loadable formats](https://github.com/PCSX2/pcsx2/blob/master/pcsx2/VMManager.cpp)). Save preferences. Scanning is recursive, skips hidden entries and symbolic links, and includes the game download directory automatically. The same formats work locally and in cloud transfers.

   `.cue`/`.toc` files describe a disc; they do not contain its data. [PCSX2 does not open them directly](https://pcsx2.net/docs/setup/discs/). For CUE/BIN dumps, include the associated `.bin` image in a scanned folder; the launcher lists and launches that image. A CUE without its referenced images produces a library warning. ZIP/7z/RAR archives need extraction first. GS dumps replay graphics and are not playable games.

4. **Cloud:** choose **Dropbox** or **MEGA**. Dropbox connects through browser authorization; MEGA uses the email/password form, with an optional two-factor code. Windows/Linux x64 packages include Rclone as a private cloud component; no separate application installation or configuration is needed. Development builds download it automatically on connection when unavailable. You supply your own cloud account, without developer API keys or a hosted service.
5. Saves synchronize automatically before gameplay and after PCSX2 closes. Keep the launcher open while playing. Use **Sync saves now** to retry, or disable automatic synchronization in Settings. Games transfer only on request through game-card actions. Manual upload/download buttons still offer a preview before transferring.

## Reset launcher data

Open **Settings → Reset data** to remove saved cloud connections, launcher preferences,
covers, logs, synchronization history and caches. Confirm **Delete data and reload**;
the launcher reloads after completion. PCSX2 must be closed and all transfers finished
or cancelled first.

Games, BIOS, memory cards, save states, backups, PCSX2 binaries and PCSX2 settings stay
on disk. Their configured paths are retained. Cloud files and custom external Rclone
configuration files are kept; the launcher switches back to its own disconnected
configuration. If launcher metadata overlaps protected game/emulator paths, reset
refuses to delete anything. `npm run test:reset` verifies this using an isolated profile.

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

If older launcher versions let the wizard populate `<parent>/PCSX2/memcards`, `sstates`, or `bios` while the configured default folders remained empty, preparation preserves those populated directories by selecting their paths. Files are not moved or removed. Custom or populated configured save folders are not replaced. Do not leave another PCSX2 instance open while changing profiles or synchronizing saves. The launcher blocks save transfers while its own PCSX2 child runs; game transfers continue in the background. Independently started processes cannot be reliably detected everywhere.

PCSX2 detection checks the configured path, managed manifest, PATH, Windows `Program Files/PCSX2`, and Linux `/usr/bin/pcsx2`. Choose other installations manually. Flatpak launch wrappers are not automatically managed. External installations report `-version` where supported. Updating an external installation creates a managed copy; it does not overwrite that external installation.

## Cloud storage and save safety

Dropbox's default remote is `ps2-dropbox`; MEGA's is `ps2-mega`. Both default to `PS2Cloud`. Change the selected provider in **Cloud**, and its folder in Settings. Remote names, custom executable and existing configuration paths are under **Advanced cloud settings**. Switching remembers each provider's remote/folder and keeps both saved connections; existing Dropbox preferences migrate automatically. Switching is blocked during gameplay and automatic save synchronization. Accepted background jobs keep their original account and paths, including when switching providers. It does not itself transfer or delete files. The game library refreshes from the selected cloud. Local games and save directories remain shared; subsequent save synchronization merges current local saves with the selected cloud, using its own history and normal conflict/backup rules.

Packaged builds prefer the included executable. Configurations are stored in the launcher user-data `credentials/rclone.conf`. Saved credentials are never returned to the renderer or stored in preferences JSON. MEGA credentials enter through the form, pass to the backend once and are cleared from the password/code fields after submission. They are sent to the private Rclone API over authenticated loopback HTTP, never command-line arguments. The password is stored using Rclone's reversible obscuring, not encryption; MEGA may also persist session keys in this configuration. Two-factor codes are held in memory and never written by the launcher. Linux configuration permissions are restricted to the current user. On Windows, keep the configuration in your private user profile; the launcher inherits its filesystem ACLs.

MEGA uses a persistent Rclone process to reuse the login session across listing and transfer operations. Its API binds only to `127.0.0.1` on a random port with a random per-process password and shuts down when switching providers or quitting. **Change MEGA account** replaces only the MEGA connection; a failed login restores the previous configuration, including Dropbox. A fresh MEGA account must first be opened in a browser to initialize its keys. If an expired session or two-factor authentication prevents access, reconnect with a fresh code. Provider transfer quotas still apply. MEGA does not preserve uploaded modification times or provide hashes, so automatic save comparison downloads content and computes SHA-256 locally. Duplicate remote paths are rejected.

Automatic save synchronization compares SHA-256 content hashes against the last successful synchronization for this provider, configuration and save-folder pair. New files merge in both directions; deletions are never propagated. If both copies differ without a known common version, a dialog offers local saves, cloud saves, or cancellation. Cancellation stops game launch and applies no file transfers. Replaced copies are retained in the same backup locations as manual transfers. Sync history advances only after both sides have been downloaded and verified again; partial failures do not mark saves as synchronized. Save content is downloaded to temporary private staging directories for comparison, then removed. This uses extra bandwidth, especially for large save-state collections.

An unconnected installation plays locally. Once connected, synchronization failure before a game offers **Cancel** or **Play offline**. After gameplay the launcher attempts synchronization again, including for an offline session, and reports failures with local saves retained. **Sync saves now** retries without launching a game. Avoid playing on another device until synchronization succeeds. The launcher stays open during a connected game session so it can handle the emulator exit; forced termination, OS shutdown, or an external emulator process cannot guarantee an upload. There is no cross-device lock: avoid simultaneous gameplay. Rechecks detect common concurrent edits but cannot make cloud writes atomic across clients.

```text
PS2Cloud/
  Games/       # all supported PCSX2 image, homebrew and dump formats
  Memcards/    # memory cards, including folder cards
  SaveStates/  # save states
  Backups/     # prior cloud files organized by transfer ID and category
```

Rclone opens Dropbox OAuth in your default browser. Approve it there and leave the launcher open. Reconnect uses the existing remote without displaying tokens. Network errors, denied access and missing dependencies appear in the UI. If OAuth fails, use the official [Rclone Dropbox guide](https://rclone.org/dropbox/), then select the resulting configuration and remote in Settings. The launcher supports unencrypted configurations and configurations already usable noninteractively by Rclone; interactive config-password entry is not implemented.

Transfers use **`rclone copyto`, never `rclone sync`**. Each preview lists source sizes, destination sizes and replacements. Existing destinations are conservatively treated as conflicts, including same-size files. A confirmed transfer rechecks source/destination metadata and settings; a stale preview must be reviewed again. Missing source files never remove destination files. Symbolic links in local destination paths and cloud path traversal are rejected.

Before an existing file is replaced, it is preserved in a backup (`--backup-dir` for automatic save operations). Background downloads copy to a unique `.partial` file, then publish the complete image. Background uploads stage a unique cloud `.partial`, back up the old object with `moveto`, then move the completed object into place; a failed commit attempts to restore the original. Only a job's own temporary file is deleted during cleanup. Upload backups remain in the selected cloud under `Backups/<transfer-id>/<category>/`; download backups stay in the launcher's user-data `backups/<transfer-id>/<category>/`. Nested paths are preserved. A failed transfer may leave completed files and their backups; refresh and review a new preview before retrying. Backups are retained until you remove them yourself. Ensure sufficient storage for both originals and replacements.

**Downloads**, at the bottom of the sidebar, lists uploads, downloads, queued jobs and recent results. Up to two transfers run at once; additional jobs wait in order. Every active or queued job has a cancel X, also available on its game card. Cancelling one job leaves other jobs running. Game transfers do not block navigation or starting/playing installed games. Save transfers remain protected: finish or cancel a running save transfer before playing; queued saves wait until PCSX2 exits and automatic save synchronization finishes. The image currently used by PCSX2 cannot be replaced.

Each accepted job uses an isolated Rclone client and a private config snapshot under `<userData>/transfer-staging/<job-id>/`, removed after completion/cancellation. Credentials and destinations remain stable if the active account changes. Closing the launcher cancels pending jobs and cleans their staging files; there is no cross-restart resume. Cancellation during a short final commit waits for that commit/rollback; a fully committed file remains complete. Interrupted multi-file save jobs retain any earlier completed files. Forced termination or unavailable cloud access may leave uniquely named temporary files for later manual cleanup.

Metadata checks prevent common stale-preview mistakes, but cannot lock remote clients or independently running emulators. Close PCSX2 for save transfers and avoid modifying the same files on another device during transfers. Use compatible PCSX2 versions across devices for save states.

## Library behavior and artwork

Each game card has a three-dot menu beside its title. **Удалить игру** opens a confirmation with the local image path and a fresh check of the selected cloud: a missing copy warns that the image will be lost; an existing cloud copy can be downloaded again. An unavailable cloud is explicitly reported as unverified. **Отменить**, Escape, or closing the dialog leaves the file untouched. **Удалить** permanently removes only the selected local image; cloud files, saves and artwork remain intact. Cloud-only games have no local image to delete. Active/queued transfers of that file and the game currently used by PCSX2 prevent deletion. Confirmation expires after five minutes and is rejected if the local file, settings or cloud status changes.

### MEGA transfer performance and diagnostics

MEGA's existing persistent Rclone process is retained. Runtime flags force `--mega-use-https`, `--bwlimit off`, `--bwlimit-file off`, and `--tpslimit 0`, including for older saved accounts. MEGA downloads to disk use four streams above 64 MiB with 16 MiB chunks. Uploads retain the MEGA backend's normal behavior; download threading does not imply parallel MEGA uploads. Dropbox transfer/authentication behavior and provider switching remain supported.

Transfer UI shows current payload speed in B/s, KiB/s or MiB/s. Average speed is retained only in diagnostic logs. Current speed uses byte deltas over each sample interval, including zero during stalls. Each MEGA transfer has its own Rclone stats group, preventing previous jobs or global averages from distorting progress. These are payload rates, not total encrypted network traffic.

**Cloud > Open transfer logs** opens `<userData>/logs/`. `transfers.jsonl` records start/finish, effective MEGA options, per-second bytes, current/average/Rclone speed, elapsed time, retries, quota/HTTP error categories and multi-thread activity. Logs rotate at 5 MiB and retain one previous file. Passwords, tokens, signed URLs and raw backend responses are excluded; debug output is reduced to approved structured fields. Logging failures do not fail transfers.

To compare direct Rclone, the identical command launched from Electron, and the normal Electron MEGA service, build first and create an ignored manifest JSON with absolute `binary` and `config` paths, a `remote` object path, and optional local `source` reference for SHA-256 verification. Use an isolated config copy because Rclone may refresh saved sessions. `npm run benchmark:mega -- --manifest <manifest.json> --output test-results/mega-benchmark` runs single/four-stream downloads with a 120-second limit per case. It only downloads existing objects and writes reports/temporary files locally. `--cases direct-multi,electron-cli-multi,electron-rc-multi` runs the matched four-stream comparison. Compare repeated cases: MEGA/server/network conditions vary, so one sample does not establish Electron overhead. A synthetic 128 MiB image was used for live verification; no user game was available in the connected account.

- **Local Only:** Play locally or **Upload to Cloud**.
- **In Cloud:** available on disk and the selected cloud; **Play**.
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
electron/services/rclone.ts     Bundled component, Dropbox/MEGA sign-in, listing
electron/services/rclone-rc.ts  Private persistent MEGA session and transfer API
electron/services/auto-sync.ts  Three-way content comparison, conflict choices, save merge
electron/services/sync.ts       Conflict plans, stale checks, copy-only execution
src/App.tsx                     Four pages, notifications and transfer review
src/styles.css                  Responsive dark interface and reduced-motion support
tests/services.test.ts          Service regression tests
scripts/smoke.cjs               Real Electron IPC and UI smoke test
scripts/integration.cjs         Official binary / real Rclone integration
scripts/verify-cloud.cjs        Two-device merge and provider switching with isolated aliases
```

The renderer has no Node.js integration. Context isolation, sandboxing, CSP, sender validation, schema-validated IPC, denied permissions and blocked arbitrary navigation are enabled. Processes run with argument arrays and no shell. External links are restricted to fixed documentation URLs. No credentials are logged by the OAuth flow. Keep configuration files, user data, emulator files and `.env` files out of Git.

## Releases

GitHub Actions tests and builds Windows and Linux on native runners. Tags and manual workflow runs also execute official-binary and real Rclone integration tests on both platforms. A `v*` tag creates a **draft** GitHub release with Windows installers and Linux packages after both builds pass. No signing certificate is configured; configure signing before distributing production releases. Normal pushes and pull requests upload build artifacts without publishing a release.

Packaging downloads pinned Rclone v1.75.2 for the target Windows/Linux x64 platform, verifies the official SHA-256 archive checksum and includes the executable, version and upstream MIT license in `resources/cloud/`. The packaging hook fails if download or verification fails, rather than shipping an installer without its cloud component.

The launcher requires real Dropbox/MEGA accounts for end-to-end provider verification and your own BIOS/disc for gameplay testing. The repository does not contain either. No deletion mirroring, automatic artwork downloads or paid backend is included.

## Troubleshooting

- **GitHub release rate limit:** retry later; anonymous GitHub API limits apply. No GitHub credentials are required.
- **Cloud component unavailable:** reconnect to prepare the component automatically. Official packages include it; reinstall if bundled files were removed.
- **Cloud disconnected:** check the remote/config path, reconnect, and review the reported error. Provider permissions, transfer quotas and MEGA two-factor authentication still apply.
- **PCSX2 does not launch:** import/select a valid uncompressed BIOS in Emulator, check paths, and review the PCSX2 `logs/emulog.txt` in the displayed profile directory. On Windows, PCSX2 may need the current Visual C++ runtime; see [official setup](https://pcsx2.net/docs/setup/).
- **Existing save not visible:** point Settings at its actual directory and close/reopen PCSX2. An imported external install is not automatically migrated.
- **Invalid preferences file:** repair or rename `settings.json` in Electron user data. Invalid files are not silently overwritten.
- **Windows packaging fails renaming the extracted runtime:** retry with the installed runtime: `npx electron-builder --win --x64 --publish never --config.electronDist=node_modules/electron/dist`. Use a fresh output directory if a previous unpacked application is still running.

MIT license applies to launcher code. PCSX2, Rclone and 7-Zip retain their own licenses; packaging retains dependency license files. This project is not affiliated with Sony, Dropbox, MEGA, PCSX2 or Rclone.
