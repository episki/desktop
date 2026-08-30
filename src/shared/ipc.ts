/**
 * IPC contract shared between the main process and the preload script.
 *
 * NOTE: the preload script runs sandboxed, so it may only `require('electron')`.
 * It must not import this module at runtime -- it uses `import type` only, which
 * TypeScript erases at compile time. Channel names are therefore repeated as
 * string literals in the preload, but typed against the unions below so a typo
 * fails to compile.
 */

/** Channels the main process sends to the renderer. */
export type MainToRenderer =
  | 'deep-link'
  | 'theme-updated'
  | 'window-maximized-change'
  | 'window-fullscreen-change'
  | 'update-checking'
  | 'update-available'
  | 'update-not-available'
  | 'update-download-progress'
  | 'update-downloaded'
  | 'update-error'
  | 'notification-activated'

/** Fire-and-forget channels the renderer sends to the main process. */
export type RendererToMain =
  | 'window-minimize'
  | 'window-maximize'
  | 'window-close'
  | 'download-update'
  | 'install-update'
  | 'check-for-updates'
  | 'retry-load'
  | 'set-badge-count'

/** Request/response channels the renderer invokes on the main process. */
export type RendererInvoke =
  | 'window-is-maximized'
  | 'app-info'
  | 'notifications-supported'
  | 'show-notification'

export interface DeepLinkPayload {
  url: string
  /** Pathname + search + hash, ready to hand to the router. */
  path: string
}

export interface ThemePayload {
  shouldUseDarkColors: boolean
  themeSource: string
}

export interface UpdateInfoPayload {
  version: string
  releaseDate?: string
  releaseName?: string | null
  releaseNotes?: string | null
}

export interface ProgressPayload {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateErrorPayload {
  message: string
  /** True when the user asked for this check, so the UI should surface it loudly. */
  userInitiated: boolean
}

export interface UpdateNotAvailablePayload {
  version: string
  userInitiated: boolean
}

export interface AppInfoPayload {
  version: string
  platform: NodeJS.Platform
  isPackaged: boolean
  /**
   * Whether the updater is wired up at all -- false in development.
   *
   * This is not a promise that an update will install: macOS additionally
   * requires a signed build, and there is no runtime API to check that, so an
   * unsigned packaged build still reports true.
   */
  updatesEnabled: boolean
  logPath: string
}

/** A desktop notification requested by the web app. */
export interface NotificationRequest {
  title: string
  body: string
  /**
   * In-app path to route to when the notification is clicked,
   * e.g. `/acme/tasks/123`.
   */
  path?: string
  silent?: boolean
  /** Opaque id echoed back on activation so the renderer can correlate. */
  id?: string
}

export interface NotificationResult {
  shown: boolean
  id: string
  /** Populated when `shown` is false. */
  reason?: 'unsupported' | 'error'
}

export interface NotificationActivatedPayload {
  id: string
  path?: string
}
