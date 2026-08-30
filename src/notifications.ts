import { app, BrowserWindow, nativeImage, Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import { isMac, isWindows } from './config'
import log from './log'
import type {
  NotificationActivatedPayload,
  NotificationRequest,
  NotificationResult,
} from './shared/ipc'

/**
 * Native OS notifications for the web app's existing comms events
 * (task assigned, assessment due, etc.). The renderer decides *when* to notify
 * based on the user's `comm_preferences`; this module only renders them.
 */
export function showNotification(
  win: BrowserWindow | null,
  request: NotificationRequest,
): NotificationResult {
  const id = request.id ?? randomUUID()

  if (!Notification.isSupported()) {
    return { shown: false, id, reason: 'unsupported' }
  }

  const title = request.title?.trim()
  if (!title) {
    log.warn('[Notifications] Refusing to show a notification without a title')
    return { shown: false, id, reason: 'error' }
  }

  try {
    const notification = new Notification({
      title,
      body: request.body ?? '',
      silent: request.silent ?? false,
    })

    notification.on('click', () => {
      focusWindow(win)
      if (win && !win.isDestroyed()) {
        const payload: NotificationActivatedPayload = { id, path: request.path }
        win.webContents.send('notification-activated', payload)
      }
    })

    notification.show()
    return { shown: true, id }
  }
  catch (error) {
    log.error('[Notifications] Failed to show notification:', error)
    return { shown: false, id, reason: 'error' }
  }
}

function focusWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  if (isMac) app.focus({ steal: true })
}

const OVERLAY_SIZE = 16

/**
 * A 16x16 dot for the Windows taskbar overlay. Windows has no numeric badge
 * API, and app.setBadgeCount is macOS/Linux only, so a positive count has to be
 * drawn. Built as raw BGRA rather than loaded from disk so there is no asset to
 * package.
 */
function badgeOverlay(): Electron.NativeImage {
  const buffer = Buffer.alloc(OVERLAY_SIZE * OVERLAY_SIZE * 4)
  const centre = (OVERLAY_SIZE - 1) / 2
  const radius = OVERLAY_SIZE / 2

  for (let y = 0; y < OVERLAY_SIZE; y++) {
    for (let x = 0; x < OVERLAY_SIZE; x++) {
      const i = (y * OVERLAY_SIZE + x) * 4
      const distance = Math.hypot(x - centre, y - centre)
      // One pixel of feathering so the dot does not look jagged.
      const coverage = Math.max(0, Math.min(1, radius - distance))
      buffer[i] = 0x3b // B
      buffer[i + 1] = 0x30 // G
      buffer[i + 2] = 0xe0 // R
      buffer[i + 3] = Math.round(coverage * 255)
    }
  }

  return nativeImage.createFromBitmap(buffer, {
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE,
  })
}

/**
 * Unread indicator. macOS and Linux get a numeric badge; Windows has no numeric
 * API, so it gets a taskbar overlay dot with the count in its accessible
 * description. Pass 0 to clear.
 */
export function setBadgeCount(win: BrowserWindow | null, count: number): void {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0

  if (!isWindows) {
    try {
      app.setBadgeCount(safe)
    }
    catch (error) {
      log.warn('[Notifications] setBadgeCount failed:', error)
    }
  }

  if (!win || win.isDestroyed()) return

  if (isWindows) {
    try {
      win.setOverlayIcon(
        safe > 0 ? badgeOverlay() : null,
        safe > 0 ? `${safe} unread` : '',
      )
    }
    catch (error) {
      log.warn('[Notifications] setOverlayIcon failed:', error)
    }
  }

  // Nudge the taskbar entry too, but only when the user is not already looking.
  if (!isMac) {
    win.flashFrame(safe > 0 && !win.isFocused())
  }
}
