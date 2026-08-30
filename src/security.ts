import { app, session, shell, type WebContents } from 'electron'
import { isAllowedUrl } from './config'
import log from './log'

/** Schemes we are willing to hand to the OS. Blocks file://, smb://, etc. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * Permissions the web app legitimately needs. Everything else is denied
 * outright -- Electron's default handler approves most requests, which would
 * let any page that ends up loaded ask for camera, microphone or location.
 */
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
])

export function openExternal(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    log.warn('[Security] Refusing to open malformed URL:', url)
    return
  }

  if (!EXTERNAL_SCHEMES.has(parsed.protocol)) {
    log.warn('[Security] Refusing to open URL with scheme:', parsed.protocol)
    return
  }

  void shell.openExternal(parsed.href)
}

/**
 * Applied to every WebContents the app creates, including any future ones.
 * Keeps in-window navigation on our own origin and pushes everything else --
 * OAuth included, which returns through the `episki://` deep link -- to the
 * system browser.
 */
function harden(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      return { action: 'allow' }
    }
    openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(url)) return
    event.preventDefault()
    openExternal(url)
  })

  // The app has no need for <webview>; refuse to attach one and strip any
  // preload/nodeIntegration an injected tag might try to request.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    log.warn('[Security] Blocked webview attach:', params.src)
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    event.preventDefault()
  })
}

export function installSecurityPolicy(): void {
  app.on('web-contents-created', (_event, contents) => harden(contents))

  const defaultSession = session.defaultSession

  defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission)
      && isAllowedUrl(details.requestingUrl ?? '')
    if (!allowed) {
      log.info(`[Security] Denied permission "${permission}" for ${details.requestingUrl}`)
    }
    callback(allowed)
  })

  defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAllowedUrl(requestingOrigin)
  })

  // Nothing in this app loads remote code into a privileged context, and no
  // page should be able to request an HID/serial/USB device.
  defaultSession.setDevicePermissionHandler(() => false)
}
