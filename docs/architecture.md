# Application structure

The renderer groups code by launcher feature. Electron owns privileged operations;
the renderer calls only the typed preload bridge in `shared/types.ts`.

## Renderer

- `src/App.tsx`: application composition and screen selection.
- `src/app/LauncherProvider.tsx`: composes session-scoped hooks. It stays mounted
  while screens change, so navigation does not interrupt subscriptions or discard drafts.
- `src/app/useLauncherState.ts`: initial snapshot, library refresh, progress events,
  operation state and notifications. `useLauncher()` exposes the typed context.
- `src/features/games`: library view, cards and confirmed local deletion.
- `src/features/emulator`: PCSX2 installation and BIOS controls.
- `src/features/cloud`: provider selection, MEGA form and save synchronization controls.
  Credentials remain local to the Cloud screen and clear on submission/provider change.
- `src/features/settings`: settings tabs and the session-scoped preferences draft.
  Snapshot refreshes update untouched fields while retaining unsaved edits. Saving
  accepts the normalized settings returned by Electron. Provider-specific paths
  follow the newly selected provider.
  The Reset data tab uses an explicit confirmation and reloads the renderer after
  reset. `electron/services/reset.ts` validates an allowlist of launcher metadata
  paths against protected games, saves, BIOS, emulator and backup locations.
- `src/features/transfers`: queue subscription, downloads screen and sync preview.
  `useTransfers` runs in the provider, even when Downloads is not visible. Terminal
  transfers refresh the library once per transfer ID.
- `src/layout`: sidebar, topbar, progress and notifications.
- `src/components`: reusable presentation controls. `Dialog` handles focus,
  Tab wrapping, Escape blocking and focus restoration.
- `src/lib`: preload bridge access and formatting helpers.
- `src/styles.css`: ordered imports. Keep their order: responsive rules and later
  transfer styles depend on the existing CSS cascade.

Keep feature-specific state in its feature hook. Add session state to the provider
only when it must survive navigation or coordinate multiple screens. Shared
components receive explicit props and do not import launcher context.

## Electron

- `electron/main.ts`: startup, single-instance behavior and shutdown.
- `electron/runtime.ts`: service composition, shared operation guard and transfer workers.
- `electron/window.ts`: window creation, navigation restrictions and close protection.
- `electron/covers.ts`: validated local cover protocol.
- `electron/ipc/register.ts`: route composition by feature.
- `electron/ipc/handle.ts`: sender validation and error normalization for every route.
- `electron/ipc/dialogs.ts`: native file picker.
- `electron/services`: existing emulator, settings, game, cloud and synchronization logic.

All IPC routes must use the shared handler. Preserve `exclusive` around protected
operations and retain transfer/gameplay guards. Accepted transfers keep their own
settings snapshot and scoped cloud client.

## Verification

```sh
npm test
npm run build
npm run test:smoke
npm run test:game-deletion
npm run test:reset
```

Smoke tests use an isolated Electron profile, generated fixtures and a local Rclone
alias. They cover navigation, dirty settings across refreshes, provider switching,
concurrent transfers, cancellation, cover rendering and responsive layout. The
deletion UI check covers keyboard focus, confirmation, cloud retention and transfer
guards. IPC unit tests cover trusted/untrusted senders and error normalization.
