import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { isDev } from './config'
import log, { logFilePath } from './log'
import type {
  ProgressPayload,
  UpdateErrorPayload,
  UpdateInfoPayload,
  UpdateNotAvailablePayload,
} from './shared/ipc'

const STARTUP_DELAY_MS = 8_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/**
 * electron-updater logs the entire failed HTTP response on error, headers
 * included -- which puts GitHub's `set-cookie` values into a log file users are
 * asked to send to support. Keep only the first line, capped.
 */
const MAX_LOG_CHARS = 300

function firstLine(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)
  const line = text.split('\n', 1)[0] ?? ''
  return line.length > MAX_LOG_CHARS ? `${line.slice(0, MAX_LOG_CHARS)}…` : line
}

/** Logger handed to electron-updater, with error output truncated. */
const updaterLogger = {
  info: (message: unknown) => log.info('[Auto-Updater]', firstLine(message)),
  warn: (message: unknown) => log.warn('[Auto-Updater]', firstLine(message)),
  error: (message: unknown) => log.error('[Auto-Updater]', firstLine(message)),
  debug: (message: unknown) => log.debug('[Auto-Updater]', firstLine(message)),
}

let getWindow: () => BrowserWindow | null = () => null
let checkInFlight = false
let downloading = false
/** Whether the check currently running was triggered from the menu. */
let userInitiated = false

/**
 * The updater is only wired up in packaged builds. Set EPISKI_TEST_UPDATER=1 to
 * force it on in development against `dev-app-update.yml`.
 */
export function updatesEnabled(): boolean {
  return !isDev || process.env.EPISKI_TEST_UPDATER === '1'
}

function send(channel: string, payload: unknown): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

export function setupAutoUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter

  if (!updatesEnabled()) {
    log.info('[Auto-Updater] Disabled in development (set EPISKI_TEST_UPDATER=1 to test)')
    return
  }

  if (isDev) {
    // Makes electron-updater read dev-app-update.yml instead of the packaged
    // app-update.yml, so the feed can be exercised without cutting a release.
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.logger = updaterLogger
  autoUpdater.autoDownload = false
  // Security updates should not be silently skipped if a channel is misread.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    log.info('[Auto-Updater] Checking for updates...')
    send('update-checking', { userInitiated })
  })

  autoUpdater.on('update-available', (info) => {
    checkInFlight = false
    log.info('[Auto-Updater] Update available:', info.version)
    const payload: UpdateInfoPayload = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName ?? null,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    }
    send('update-available', payload)
    userInitiated = false
  })

  autoUpdater.on('update-not-available', (info) => {
    checkInFlight = false
    log.info('[Auto-Updater] No updates available')
    const payload: UpdateNotAvailablePayload = { version: info.version, userInitiated }
    send('update-not-available', payload)
    if (userInitiated) {
      void dialog.showMessageBox({
        type: 'info',
        title: 'You are up to date',
        message: `episki ${app.getVersion()} is the latest version.`,
        buttons: ['OK'],
      })
    }
    userInitiated = false
  })

  autoUpdater.on('error', (err) => {
    checkInFlight = false
    downloading = false
    log.error('[Auto-Updater] Error:', firstLine(err))
    const payload: UpdateErrorPayload = {
      message: firstLine(err),
      userInitiated,
    }
    // Previously this was only logged, so the UI could never tell the user that
    // an update check had failed.
    send('update-error', payload)
    if (userInitiated) {
      void dialog.showMessageBox({
        type: 'error',
        title: 'Update check failed',
        message: 'episki could not check for updates.',
        detail: `${payload.message}\n\nLog file: ${logFilePath()}`,
        buttons: ['OK'],
      })
    }
    userInitiated = false
  })

  autoUpdater.on('download-progress', (progress) => {
    const payload: ProgressPayload = {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    }
    send('update-download-progress', payload)
  })

  autoUpdater.on('update-downloaded', (info) => {
    downloading = false
    log.info('[Auto-Updater] Update downloaded:', info.version)
    const payload: UpdateInfoPayload = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName ?? null,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    }
    send('update-downloaded', payload)
  })

  setTimeout(() => checkForUpdates({ userInitiated: false }), STARTUP_DELAY_MS)
  setInterval(() => checkForUpdates({ userInitiated: false }), CHECK_INTERVAL_MS)
}

export function checkForUpdates(options: { userInitiated: boolean }): void {
  if (!updatesEnabled()) {
    if (options.userInitiated) {
      void dialog.showMessageBox({
        type: 'info',
        title: 'Updates unavailable',
        message: 'Automatic updates are disabled in development builds.',
        buttons: ['OK'],
      })
    }
    return
  }

  if (downloading || checkInFlight) {
    log.info('[Auto-Updater] Check skipped, one is already in progress')
    return
  }

  checkInFlight = true
  userInitiated = options.userInitiated

  // checkForUpdates() rejects when the feed is unreachable. Without this catch
  // that surfaces as an unhandled rejection; the 'error' handler above still
  // does the user-facing reporting.
  autoUpdater.checkForUpdates()?.catch((error: unknown) => {
    checkInFlight = false
    log.error('[Auto-Updater] Check failed:', firstLine(error))
  })
}

export function downloadUpdate(): void {
  if (!updatesEnabled() || downloading) return
  downloading = true
  autoUpdater.downloadUpdate().catch((error: unknown) => {
    downloading = false
    log.error('[Auto-Updater] Download failed:', firstLine(error))
    send('update-error', {
      message: firstLine(error),
      userInitiated: false,
    } satisfies UpdateErrorPayload)
  })
}

export function installUpdate(): void {
  if (!updatesEnabled()) return
  log.info('[Auto-Updater] Restarting to install')
  // isSilent=false, isForceRunAfter=true so the app comes back up.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}
