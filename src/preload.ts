import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppInfoPayload,
  DeepLinkPayload,
  MainToRenderer,
  NotificationActivatedPayload,
  NotificationRequest,
  NotificationResult,
  ProgressPayload,
  RendererInvoke,
  RendererToMain,
  ThemePayload,
  UpdateErrorPayload,
  UpdateInfoPayload,
  UpdateNotAvailablePayload,
} from './shared/ipc'

/**
 * This preload runs sandboxed, so it may only require('electron'). The imports
 * above are `import type` and are erased at compile time -- do not add a value
 * import from a relative path here, it will fail at runtime.
 *
 * Channel names are literals typed against the unions in shared/ipc.ts, so a
 * typo on either side of the boundary is a compile error.
 */

type Unsubscribe = () => void

function on<T>(channel: MainToRenderer, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function send(channel: RendererToMain, ...args: unknown[]): void {
  ipcRenderer.send(channel, ...args)
}

function invoke<T>(channel: RendererInvoke, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,

  /** Version, packaging state, whether updates can apply, and the log path. */
  getAppInfo: () => invoke<AppInfoPayload>('app-info'),

  // ---- Window controls (Windows/Linux frameless) ----
  minimize: () => send('window-minimize'),
  maximize: () => send('window-maximize'),
  close: () => send('window-close'),
  isMaximized: () => invoke<boolean>('window-is-maximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void) =>
    on<boolean>('window-maximized-change', callback),
  onFullScreenChange: (callback: (fullScreen: boolean) => void) =>
    on<boolean>('window-fullscreen-change', callback),

  // ---- Auth ----
  /**
   * OAuth runs in the system browser and returns here, so the provider sees a
   * real browser: the password manager works, an existing provider session is
   * reused, and Google is not being handed an embedded user agent.
   */
  getAuthCallbackUrl: () => 'episki://auth/callback',

  // ---- Deep links ----
  onDeepLink: (callback: (data: DeepLinkPayload) => void) =>
    on<DeepLinkPayload>('deep-link', callback),

  // ---- Theme ----
  onThemeUpdated: (callback: (theme: ThemePayload) => void) =>
    on<ThemePayload>('theme-updated', callback),

  // ---- Native notifications ----
  /** Resolves false on platforms where notifications are unavailable. */
  notificationsSupported: () => invoke<boolean>('notifications-supported'),
  /**
   * Show an OS notification. `path` is the in-app route to open when the user
   * clicks it, delivered back through `onNotificationActivated`.
   */
  showNotification: (request: NotificationRequest) =>
    invoke<NotificationResult>('show-notification', request),
  onNotificationActivated: (callback: (data: NotificationActivatedPayload) => void) =>
    on<NotificationActivatedPayload>('notification-activated', callback),
  /** Unread count for the dock/taskbar badge. Pass 0 to clear. */
  setBadgeCount: (count: number) => send('set-badge-count', count),

  // ---- Auto-updater ----
  checkForUpdates: () => send('check-for-updates'),
  downloadUpdate: () => send('download-update'),
  installUpdate: () => send('install-update'),
  onUpdateChecking: (callback: (data: { userInitiated: boolean }) => void) =>
    on<{ userInitiated: boolean }>('update-checking', callback),
  onUpdateAvailable: (callback: (info: UpdateInfoPayload) => void) =>
    on<UpdateInfoPayload>('update-available', callback),
  onUpdateNotAvailable: (callback: (info: UpdateNotAvailablePayload) => void) =>
    on<UpdateNotAvailablePayload>('update-not-available', callback),
  onUpdateDownloadProgress: (callback: (progress: ProgressPayload) => void) =>
    on<ProgressPayload>('update-download-progress', callback),
  onUpdateDownloaded: (callback: (info: UpdateInfoPayload) => void) =>
    on<UpdateInfoPayload>('update-downloaded', callback),
  /** Previously errors were only logged in main and never reached the UI. */
  onUpdateError: (callback: (error: UpdateErrorPayload) => void) =>
    on<UpdateErrorPayload>('update-error', callback),

  // ---- Offline page ----
  retryLoad: () => send('retry-load'),
})
