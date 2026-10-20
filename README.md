# episki Desktop App

Electron wrapper for the episki GRC platform.

## Features

- **Window State Persistence** — size, position, maximized and full-screen state, validated against the current display layout so the window never restores off-screen
- **Native Menu Bar** — standard File/Edit/View/Window/Help menus, including **Check for Updates…**
- **Auto-Updates** — background and user-initiated checks, with download progress and errors surfaced to the UI
- **Native Notifications** — OS notifications and an unread badge, driven by the web app
- **OS Theme Sync** — follows the system dark/light preference
- **Deep Linking** — OAuth callbacks via the `episki://` protocol
- **Offline Handling** — a real error page with retry when the web app can't be reached
- **Custom Window Controls** — native macOS traffic lights, custom Windows title bar

## Development

### Prerequisites

- Bun (or Node.js ≥ 22.12)

### Setup

```bash
bun install     # also fetches the Electron binary via `install-electron`
bun run dev
```

`bun run dev` loads **production** (`https://app.episki.com`), same as a packaged
build. The shell has no environment-specific behaviour, so there is nothing to
gain from pointing it elsewhere by default — and one fewer way for a release to
ship aimed at the wrong host.

> Electron 44 no longer ships a `postinstall` hook, so this repo runs
> `install-electron` itself. A plain `bun install --ignore-scripts` will leave
> you without a runnable Electron binary.

### Environment Variables

`.env` is read **in development only** — a packaged app is launched from the
Dock or Start menu with no meaningful working directory, so it is not a
supported configuration channel for releases.

```bash
# Point the shell at a locally running web app. Dev only; packaged builds
# always use https://app.episki.com.
APP_URL=http://localhost:3000
```

Whatever `APP_URL` resolves to is also the single origin allowed to load
in-window, so the navigation guard follows the override automatically.

## Architecture

```
src/
  main.ts           app lifecycle, window, deep links, IPC wiring
  config.ts         environment, URLs, allowed-origin policy
  security.ts       navigation guards, permission + device handlers
  window-state.ts   persisted geometry with display validation
  updater.ts        electron-updater wiring and event forwarding
  notifications.ts  native notifications and unread badge
  menu.ts           application menu
  offline.ts        connection-failure page
  store.ts          small JSON store (replaces electron-store)
  log.ts            electron-log setup
  preload.ts        contextBridge API exposed as window.electronAPI
  shared/ipc.ts     IPC channel + payload types shared by main and preload
```

`src/preload.ts` runs **sandboxed**, so it may only `require('electron')`. It
uses `import type` from `shared/ipc.ts` (erased at compile time) and repeats
channel names as string literals typed against those unions. Do not add a
value import from a relative path to the preload — it will fail at runtime.

### Renderer integration

The web app consumes `window.electronAPI` via:

- `app/composables/useElectron.ts`
- `app/components/electron/WindowControls.vue`
- `app/components/electron/ThemeSync.vue`
- `app/components/electron/UpdateNotification.vue`
- `app/plugins/deep-link.client.ts`

Every `on*` listener returns an unsubscribe function.

## Notifications

The main process only *renders* notifications; the web app decides when to
send them, so existing `comm_preferences` (per event, per channel) stay the
single source of truth.

```ts
const { api } = useElectron()

if (await api?.notificationsSupported()) {
  await api.showNotification({
    title: 'Task assigned to you',
    body: 'Review CC6.1 evidence',
    path: '/acme/tasks/1234',   // routed to on click
  })
}

api?.onNotificationActivated(({ path }) => path && router.push(path))

api?.setBadgeCount(unreadCount)  // 0 clears
```

Notifications require `app.setAppUserModelId()` to match `appId` in
`electron-builder.yml` — without it Windows silently drops every toast.

Badge behaviour differs by platform: macOS and Linux show the count
(`app.setBadgeCount` is macOS/Linux only), while Windows has no numeric badge
API and gets a taskbar overlay dot with the count as its accessible
description.

**macOS notifications require a signed build.** An unsigned app (a local
`bun run build:mac` with no certificate) is never registered with Notification
Center, so `showNotification` returns `{shown: true}` and nothing is displayed.
The badge is unaffected. Release builds are signed only when the signing
secrets are configured — without them the workflow ships an unsigned build and
warns; see [Signing and notarization](#signing-and-notarization).

## Auto-Updates

Checked 8 seconds after launch, every 4 hours thereafter, and on demand via
**Check for Updates…**. Downloads are never automatic; the user confirms.

Events forwarded to the renderer: `update-checking`, `update-available`,
`update-not-available`, `update-download-progress`, `update-downloaded`,
`update-error`.

### Release prerequisites

Updates are delivered from GitHub Releases on this repository
(`publish` in `electron-builder.yml`). Three things have to be true before an
update reaches a user:

1. **A published release** containing the installers *and* the `latest*.yml`
   manifests. `bun run release`, or the tag-triggered
   `.github/workflows/release.yml`, produces both. The manifests are what
   electron-updater actually reads — installers alone are not enough.
2. **Anonymous read access to releases.** electron-updater fetches
   `https://github.com/episki/desktop/releases.atom` without credentials, so the
   repository has to be publicly readable. If it is ever made private again,
   move `publish` to a public releases repository or switch the provider to
   `generic`/`s3`.
3. **A signed macOS build.** Squirrel.Mac will not apply an update to an
   unsigned app — it downloads and then does nothing. The release workflow
   signs and notarizes when the secrets described under
   [Signing and notarization](#signing-and-notarization) are present, and
   warns in the job log when they are not.

Windows signing is not configured yet, so installs and updates show a
SmartScreen prompt. Linux `.deb` has no update path; only AppImage does.

### Testing the updater without packaging

```bash
EPISKI_TEST_UPDATER=1 bun run dev
```

Reads `dev-app-update.yml` instead of the packaged manifest. Keep that file in
sync with the `publish` block in `electron-builder.yml`.

## Deep Linking

The app registers the `episki://` protocol. OAuth deliberately round-trips
through the system browser and returns via `episki://auth/callback?code=…`;
`useConfirmationUrl` picks the right callback URL per environment.

`episki://auth/callback` parses with host `auth` and pathname `/callback`, so
the main process folds the host back into the route before handing
`/auth/callback` to the renderer.

## Security

- In-window navigation is restricted by **origin comparison**, not prefix
  matching. Everything else opens in the system browser, and only
  `http:`/`https:`/`mailto:` URLs are handed to the OS.
- Permissions are denied by default; only notifications, sanitized clipboard
  writes and fullscreen are granted, and only to allowed origins.
- HID/serial/USB device access is refused outright.
- `<webview>` attachment is blocked.
- Notification and badge IPC is rejected unless the sending frame is on an
  allowed origin.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## Building

```bash
bun run build:mac      # dmg + zip (universal)
bun run build:win      # nsis (x64 + arm64)
bun run build:linux    # AppImage + deb (x64)
bun run release        # builds and publishes to GitHub Releases
bun run lint           # eslint; CI requires it to pass (lintfix to auto-fix)
```

Output lands in `dist-electron/`. The macOS **zip** target is what Squirrel.Mac
consumes — dropping it breaks macOS auto-update even if the DMG is published.

### Icons

`build/icon.png` (1024×1024) is the only icon asset. electron-builder derives
`.icns`, `.ico` and the Linux PNG set from it at pack time, so a fresh clone
builds with no extra step. Regenerate it from `icon.svg` with:

```bash
rsvg-convert -w 1024 -h 1024 icon.svg -o build/icon.png
```

`icon.svg` is the whole icon, background included, and renders edge to edge.
That is deliberate. The artwork used to be the bare hexagon on transparency,
rendered at 824 and padded out to 1024 to sit inside the macOS icon grid — which
looked right in development, where the dock shows the PNG as given. macOS 26
does not: it wraps a transparent icon in its own light plate and insets the
artwork *again*, so the shipped icon was a small hexagon adrift in a grey tile.

Owning the background is what fixes it. macOS masks the square canvas to its
squircle, so the icon fills its slot like every other app's; the mark sits at
700 of 1024, inside the grid, and the background is episki.com's (slate-950,
the OG image's 135° gradient, and the blue radial glow the site uses behind
hero artwork). Windows and Linux get the same square tile unmasked.

CI re-renders the SVG and compares it to the committed PNG, so the two cannot
quietly drift apart — the PNG is binary, so a review will not catch it. The
comparison is perceptual (RMSE) rather than byte-for-byte, because a different
`librsvg` build encodes the same picture differently and a hash would fail on
renderer upgrades instead of on drift.

That means a **tolerance**, currently `0.005`: it clears rasteriser noise
(measured at `0.0018` even across a completely different resampling path) and
catches every real edit calibrated against — recolouring the mark, shifting the
background gradient, changing the mark's size or stroke weight, all `0.0079`
and above. A change smaller than that, such as nudging the glow's opacity by
`0.05`, will pass; if you make one, re-render by hand. The calibration table
lives in the `icon` job in `.github/workflows/ci.yml`.

## Logs

`electron-log` writes to the platform log directory, surfaced in
**Help → Open Log File**:

- macOS — `~/Library/Logs/episki/main.log`
- Windows — `%USERPROFILE%\AppData\Roaming\episki\logs\main.log`
- Linux — `~/.config/episki/logs/main.log`

## Publishing

Bump `version` in `package.json`, then push a tag:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

`.github/workflows/release.yml` builds on macOS, Windows and Linux runners and
publishes to GitHub Releases.

### Signing and notarization

macOS builds are signed with a **Developer ID Application** certificate and
notarized through an **App Store Connect API key**. Both come from the Apple
Developer account and are supplied to the release workflow as repository
secrets:

| Secret                 | Value                                                        |
| ---------------------- | ------------------------------------------------------------ |
| `MAC_CSC_LINK`         | base64 of the certificate exported as `.p12` from Keychain   |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password                                          |
| `APPLE_API_KEY_P8`     | contents of the API key's `.p8` file                         |
| `APPLE_API_KEY_ID`     | the key id shown in App Store Connect                        |
| `APPLE_API_ISSUER`     | the issuer id (a UUID) shown in App Store Connect            |

Creating them:

1. **Certificate.** Developer portal → Certificates → **Developer ID
   Application**. Only the Account Holder can create this type. Generate the
   CSR in Keychain Access, upload it, download and install the certificate,
   then export the certificate *and its private key* as a password-protected
   `.p12` and `base64 -i cert.p12 | pbcopy`.
2. **API key.** App Store Connect → Users and Access → Integrations → Team
   Keys, role **Developer**. The `.p8` downloads once; store it somewhere
   durable. An API key is used rather than an Apple ID and app-specific
   password so the pipeline is not tied to one person's login or 2FA.

The workflow only exports these to electron-builder when they are set. With
no secrets it prints a warning and ships an unsigned build, which installs
with a Gatekeeper prompt and cannot auto-update. With the certificate but no
API key it ships signed but un-notarized, which Gatekeeper refuses outright,
so add all five together.

After the build the workflow runs `codesign --verify` and `spctl --assess` on
the `.app`, so a bad certificate or rejected notarization fails the release
rather than surfacing on a customer's machine.

Windows signing is a separate certificate (Azure Trusted Signing is the
cheapest route and is supported by electron-builder 26) and is not configured;
the env hooks for it are commented in `release.yml`.
