import { app, BrowserWindow, ipcMain, nativeTheme, Notification } from 'electron'
import path from 'node:path'
import {
  APP_URL,
  APP_USER_MODEL_ID,
  isAppOrigin,
  isDev,
  isMac,
  isWindows,
  PROTOCOL,
} from './config'
import log, { logFilePath } from './log'
import { installDragRegionFallback } from './drag-region'
import { createMenu } from './menu'
import { setBadgeCount, showNotification } from './notifications'
import { offlinePageUrl } from './offline'
import { installSecurityPolicy } from './security'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  setupAutoUpdater,
  updatesEnabled,
} from './updater'
import { restoreWindowState, trackWindowState } from './window-state'
import type {
  AppInfoPayload,
  DeepLinkPayload,
  NotificationRequest,
  ThemePayload,
} from './shared/ipc'

// Only load .env in development. In a packaged app the working directory is
// wherever the launcher happened to be, so this either no-ops or picks up a
// stray file -- either way it is not a supported configuration channel.
if (isDev) {
  try {
    // Required lazily: dotenv is a devDependency and is absent from builds.
    ;(require('dotenv') as typeof import('dotenv')).config()
  }
  catch {
    // dotenv is optional
  }
}

/** Only used in development; packaged builds carry their icon in the bundle. */
const DEV_ICON = path.join(__dirname, '../build/icon.png')

let mainWindow: BrowserWindow | null = null
let pendingDeepLink: string | null = null
/** Set once the renderer has finished a load and can receive IPC. */
let rendererReady = false

const getMainWindow = () => mainWindow

// Required for Windows toast notifications and for the taskbar to associate
// windows with the installed app. Must match `appId` in electron-builder.yml.
app.setAppUserModelId(APP_USER_MODEL_ID)

// Chromium's Graphite/Dawn backend fails to create a Metal device on some Macs
// ("Failed to create MTLSharedEvent"), which kills and restarts the GPU process
// twice during startup before falling back. The fallback renders correctly, so
// this only skips two doomed process launches -- and it silences the
// "Failed to create WebGPU Context Provider" errors pages then hit.
// Command-line switches must be set before the app is ready.
// Revisit when Electron ships a Chromium with the Dawn/Metal fix.
if (isMac) {
  app.commandLine.appendSwitch('disable-features', 'SkiaGraphite')
}

/* ------------------------------------------------------------------ *
 * Single instance
 * ------------------------------------------------------------------ */

// Bail out immediately when another instance owns the lock. The previous code
// called app.quit() but then went on to register the ready handler, so a second
// launch could still start creating windows before the quit landed.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
else {
  registerProtocolClient()
  bootstrap()
}

function registerProtocolClient(): void {
  if (process.defaultApp) {
    // Running via `electron .` -- the protocol handler has to point back at the
    // electron binary plus this project's entry point.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]!),
      ])
    }
  }
  else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }
}

function bootstrap(): void {
  app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`))
    if (url) handleDeepLink(url)
    focusMainWindow()
  })

  // Registered synchronously at module scope: on macOS `open-url` can fire
  // before the app is ready when a link launches the app cold.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  app.whenReady().then(onReady).catch((error: unknown) => {
    log.error('[Main] Failed to start:', error)
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
    else {
      focusMainWindow()
    }
  })
}

function onReady(): void {
  log.info(`[Main] Starting episki ${app.getVersion()} (${process.platform}), log: ${logFilePath()}`)

  if (isMac) {
    app.setActivationPolicy('regular')
    app.setAboutPanelOptions({
      applicationName: 'episki',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright (c) episki',
    })
  }

  installSecurityPolicy()
  watchTheme()
  setupAutoUpdater(getMainWindow)
  createMenu()
  registerIpcHandlers()

  // A packaged build takes its icon from the app bundle, which electron-builder
  // generates from build/icon.png. In development the process is Electron.app,
  // so the dock shows Electron's own icon unless we override it here.
  if (isMac && app.dock) {
    if (isDev) {
      try {
        app.dock.setIcon(DEV_ICON)
      }
      catch (error) {
        log.warn('[Main] Could not set dev dock icon:', error)
      }
    }
    void app.dock.show()
  }

  createWindow()

  // On macOS a cold launch from a deep link may arrive as an argv entry rather
  // than an open-url event.
  const launchDeepLink = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`))
  if (launchDeepLink) {
    log.info('[Deep Link] Found on launch:', launchDeepLink)
    handleDeepLink(launchDeepLink)
  }
}

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

function createWindow(): void {
  const state = restoreWindowState()

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 700,

    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    frame: !isWindows,

    // Matching the OS theme avoids a bright white flash on launch for dark-mode
    // users; `show: false` avoids the flash of an empty window entirely.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1220' : '#ffffff',
    show: false,

    ...(isDev && !isMac ? { icon: DEV_ICON } : {}),

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  mainWindow = win
  rendererReady = false
  trackWindowState(win)
  installDragRegionFallback(win)

  win.once('ready-to-show', () => {
    if (state.isMaximized) win.maximize()
    if (state.isFullScreen) win.setFullScreen(true)
    win.show()
    win.focus()
    if (isMac) app.focus({ steal: true })
  })

  // ready-to-show never fires if the very first load fails, so make sure the
  // window still appears to show the offline page.
  const showFallback = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }, 10_000)
  win.once('closed', () => clearTimeout(showFallback))

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 is ERR_ABORTED, which fires for ordinary client-side navigations.
    if (!isMainFrame || errorCode === -3) return
    log.error(`[Main] Load failed (${errorCode} ${errorDescription}): ${validatedURL}`)
    void win.loadURL(offlinePageUrl(`${errorDescription} (${errorCode})`))
  })

  // Recover from a renderer crash, but give up after a few attempts rather than
  // reloading forever into whatever is causing the crash.
  let crashReloads = 0
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('[Main] Renderer gone:', details.reason, details.exitCode)
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    if (crashReloads >= 3) {
      log.error('[Main] Too many renderer crashes, showing the error page')
      void win.loadURL(offlinePageUrl(`The app kept crashing (${details.reason})`))
      return
    }
    crashReloads += 1
    void win.loadURL(APP_URL)
  })

  win.webContents.on('did-finish-load', () => {
    // A successful load means we are out of the crash loop.
    crashReloads = 0

    // The renderer has mounted and registered its IPC listeners, so anything
    // that arrived during startup can be delivered now. This has to stay a
    // persistent listener, not `once`: the app redirects after its first load
    // (/ -> /hub), and a spent one-shot handler is how OAuth callbacks were
    // being queued and then silently dropped.
    rendererReady = true
    flushPendingDeepLink()
  })

  win.on('unresponsive', () => log.warn('[Main] Window became unresponsive'))
  win.on('responsive', () => log.info('[Main] Window responsive again'))

  win.on('maximize', () => win.webContents.send('window-maximized-change', true))
  win.on('unmaximize', () => win.webContents.send('window-maximized-change', false))
  win.on('enter-full-screen', () => win.webContents.send('window-fullscreen-change', true))
  win.on('leave-full-screen', () => win.webContents.send('window-fullscreen-change', false))

  // A focused window has been seen, so stop nagging the taskbar.
  win.on('focus', () => {
    if (!isMac) win.flashFrame(false)
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  void win.loadURL(APP_URL)

  if (isDev) win.webContents.openDevTools({ mode: 'detach' })
}

function focusMainWindow(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

/* ------------------------------------------------------------------ *
 * Deep links
 * ------------------------------------------------------------------ */

function handleDeepLink(url: string): void {
  log.info('[Deep Link] Received:', url)

  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch (error) {
    log.error('[Deep Link] Failed to parse:', error)
    return
  }

  if (parsed.protocol !== `${PROTOCOL}:`) {
    log.warn('[Deep Link] Ignoring unexpected protocol:', parsed.protocol)
    return
  }

  const win = mainWindow
  // Gate on the renderer having mounted, not on isLoading(): the page keeps
  // navigating after its first load, so isLoading() is true often enough that
  // it dropped real callbacks.
  if (!win || win.isDestroyed() || !rendererReady) {
    log.info('[Deep Link] Renderer not ready, queuing')
    pendingDeepLink = url
    return
  }

  // `episki://auth/callback?code=...` parses with host "auth" and pathname
  // "/callback", so the host has to be folded back into the route.
  const routePath = `/${parsed.host}${parsed.pathname}`.replace(/\/+$/, '') || '/'
  const payload: DeepLinkPayload = {
    url,
    path: `${routePath}${parsed.search}${parsed.hash}`,
  }

  log.info('[Deep Link] Sending to renderer:', payload.path)
  win.webContents.send('deep-link', payload)
  focusMainWindow()
}

function flushPendingDeepLink(): void {
  const url = pendingDeepLink
  if (!url) return
  // Cleared before dispatch so a re-queue cannot loop.
  pendingDeepLink = null
  log.info('[Deep Link] Processing queued link:', url)
  handleDeepLink(url)
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

function watchTheme(): void {
  nativeTheme.on('updated', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    const payload: ThemePayload = {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      themeSource: nativeTheme.themeSource,
    }
    win.webContents.send('theme-updated', payload)
  })
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpcHandlers(): void {
  ipcMain.on('window-minimize', () => mainWindow?.minimize())
  ipcMain.on('window-maximize', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on('window-close', () => mainWindow?.close())
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.on('check-for-updates', () => checkForUpdates({ userInitiated: true }))
  ipcMain.on('download-update', () => downloadUpdate())
  ipcMain.on('install-update', () => installUpdate())

  ipcMain.on('retry-load', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    log.info('[Main] Retrying load of', APP_URL)
    void win.loadURL(APP_URL)
  })

  ipcMain.handle('show-notification', (event, request: NotificationRequest) => {
    if (!isTrustedSender(event.senderFrame?.url)) {
      return { shown: false, id: '', reason: 'error' as const }
    }
    return showNotification(mainWindow, request)
  })

  ipcMain.on('set-badge-count', (event, count: number) => {
    if (!isTrustedSender(event.senderFrame?.url)) return
    setBadgeCount(mainWindow, count)
  })

  ipcMain.handle('notifications-supported', () => Notification.isSupported())

  ipcMain.handle('app-info', (): AppInfoPayload => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    updatesSupported: updatesEnabled(),
    logPath: logFilePath(),
  }))
}

/**
 * Notifications and badges are user-visible OS surfaces, so only accept them
 * from a frame actually running our own app.
 */
function isTrustedSender(url: string | undefined): boolean {
  if (!url) return false
  if (!isAppOrigin(url)) {
    log.warn('[Main] Rejected privileged IPC from', url)
    return false
  }
  return true
}
