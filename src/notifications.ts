import { app, BrowserWindow, Notification } from 'electron'
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

/**
 * Unread count on the macOS dock, the Windows taskbar and Unity launchers.
 * Pass 0 to clear.
 */
export function setBadgeCount(win: BrowserWindow | null, count: number): void {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0

  try {
    app.setBadgeCount(safe)
  }
  catch (error) {
    log.warn('[Notifications] setBadgeCount failed:', error)
  }

  // Windows and most Linux WMs have no dock badge, so nudge the taskbar entry
  // instead -- but only when the user is not already looking at the window.
  if (!isMac && win && !win.isDestroyed()) {
    win.flashFrame(safe > 0 && !win.isFocused())
  }

  if (isWindows && win && !win.isDestroyed() && safe === 0) {
    win.setOverlayIcon(null, '')
  }
}
