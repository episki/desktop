import { app } from 'electron'

export const isMac = process.platform === 'darwin'
export const isWindows = process.platform === 'win32'

/**
 * Development is inferred from the packaging state rather than NODE_ENV.
 * A packaged app launched from the Dock inherits none of the shell's env,
 * so NODE_ENV was never a reliable signal here.
 */
export const isDev = !app.isPackaged

export const PROTOCOL = 'episki'

/** Must match `appId` in electron-builder.yml. Required for Windows notifications. */
export const APP_USER_MODEL_ID = 'com.episki.desktop'

export const PRODUCTION_URL = 'https://app.episki.com'

/**
 * The desktop app targets production in every mode, including `bun run dev` --
 * the shell has no environment-specific behaviour, so pointing it anywhere else
 * only creates a way for a build to ship aimed at the wrong host.
 *
 * APP_URL remains as a local override for working on the shell against a
 * locally running web app. It is read in development only.
 */
export const APP_URL = (isDev && process.env.APP_URL) || PRODUCTION_URL

export const APP_ORIGIN = new URL(APP_URL).origin

/**
 * The only origin allowed to load in-window. Everything else -- including the
 * OAuth chain through api.episki.com and the identity provider -- is handed to
 * the system browser and returns via the `episki://` deep link.
 *
 * This is what RFC 8252 (OAuth 2.0 for Native Apps) prescribes: an embedded
 * user agent cannot use the password manager, cannot reuse an existing provider
 * session, and is actively blocked by Google.
 */
export const ALLOWED_ORIGINS: readonly string[] = [APP_ORIGIN]

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  }
  catch {
    return null
  }
}

/**
 * Origin comparison, not prefix matching. `startsWith(APP_URL)` would accept
 * `https://app.episki.com.example.com`.
 */
export function isAllowedUrl(url: string): boolean {
  const origin = originOf(url)
  return origin !== null && ALLOWED_ORIGINS.includes(origin)
}

/**
 * Strictly the app's own origin. Privileged IPC (notifications, badge) is
 * gated on this rather than isAllowedUrl -- an identity provider is trusted to
 * render in the window, not to drive OS surfaces.
 */
export function isAppOrigin(url: string): boolean {
  return originOf(url) === APP_ORIGIN
}

export const HELP_URL = 'https://intercom.help/episki/en/'
// Help > Learn More previously opened the app host itself, i.e. the page the
// user is already looking at. The marketing site is the useful destination.
export const MARKETING_URL = 'https://episki.com'
