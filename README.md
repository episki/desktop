# episki Desktop App

Electron wrapper for the episki GRC platform.

## Features

- **Window State Persistence**: Automatically saves and restores window size, position, and maximized state
- **Native Menu Bar**: Standard application menu with keyboard shortcuts (File, Edit, View, Window, Help)
- **Auto-Updates**: Automatic update checking and installation with user notifications
- **OS Theme Sync**: Syncs with system dark/light mode preferences
- **Deep Linking**: OAuth callback support via `episki://` protocol
- **Custom Window Controls**: Native macOS traffic lights and custom Windows title bar

## Development

### Prerequisites

- Bun or Node.js
- The main episki web app running (default: `http://localhost:3000`)

### Setup

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev
```

### Environment Variables

Create a `.env` file in this directory (optional):

```bash
# App URL (defaults to localhost in dev, episki.app in production)
APP_URL=http://localhost:3000

# Node environment
NODE_ENV=development
```

## Building

### macOS

```bash
bun run build:mac
```

Outputs:
- `dist-electron/episki-{version}-universal.dmg`
- `dist-electron/episki-{version}-universal-mac.zip`

### Windows

```bash
bun run build:win
```

Outputs:
- `dist-electron/episki Setup {version}.exe`

### Linux

```bash
bun run build:linux
```

Outputs:
- `dist-electron/episki-{version}.AppImage`
- `dist-electron/episki_{version}_amd64.deb`

## Architecture

### Main Process (`src/main.ts`)

- Window management and state persistence
- Deep link handling for OAuth
- Auto-updater configuration
- Native menu creation
- IPC handlers

### Preload Script (`src/preload.ts`)

- Secure bridge between main and renderer processes
- Exposes limited Electron APIs via `window.electronAPI`

### Integration with Web App

The Electron app loads the web app and provides additional functionality:

- **Window Controls**: `app/components/electron/WindowControls.vue`
- **Theme Sync**: `app/components/electron/ThemeSync.vue`
- **Update Notifications**: `app/components/electron/UpdateNotification.vue`
- **Electron Composable**: `app/composables/useElectron.ts`

## Auto-Updates

Updates are automatically checked:
- On app startup (after 5 seconds)
- Every 4 hours while the app is running

When an update is available:
1. User is notified via toast
2. User can download the update
3. Progress is shown during download
4. User can restart to install or postpone

## Deep Linking

The app registers the `episki://` protocol for OAuth callbacks:

- **Web flow**: Redirects to `https://episki.app/auth/callback?code=...`
- **Desktop flow**: Redirects to `episki://auth/callback?code=...`

The `useConfirmationUrl` composable automatically detects Electron and uses the appropriate URL.

## Configuration Files

- `electron-builder.yml`: Build configuration for all platforms
- `entitlements.mac.plist`: macOS hardened runtime entitlements
- `icons/`: Platform-specific app icons
- `tsconfig.json`: TypeScript configuration

## Publishing

Updates are published via GitHub Releases. Configure in `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: episki
  repo: electron
```

Before publishing, update the version in `package.json`.
