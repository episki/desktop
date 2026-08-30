import type { BrowserWindow, WebContents } from 'electron'
import { isMac, isWindows } from './config'
import log from './log'

/**
 * `titleBarStyle: 'hiddenInset'` (macOS) and `frame: false` (Windows) remove the
 * native title bar, which leaves the window movable only where the page marks a
 * region with `-webkit-app-region: drag`. The web app supplies one in its
 * authenticated layout, but not on /auth/login or the offline page -- so before
 * signing in the window could not be moved at all.
 *
 * This installs a thin drag strip along the top, but only when the page has not
 * provided a region of its own, and removes it again as soon as the page does.
 */

const STRIP_HEIGHT = 38
const ID_PREFIX = '__episki_drag_'

/**
 * Lays drag strips across the top band, skipping any horizontal range occupied
 * by something clickable, so a window is always movable by its empty chrome
 * without ever swallowing a control.
 *
 * A single full-width strip is not enough: the app puts its workspace switcher
 * in that band, and a draggable region wins the hit test over whatever it
 * covers -- `pointer-events: none` does not exempt it, because Chromium
 * resolves drag regions before DOM hit testing.
 *
 * Re-run after hydration as well as on load: an SPA renders its own chrome
 * after the first paint, so a single check at load time sees an empty page and
 * draws strips over controls that do not exist yet.
 */
const SCRIPT = `(() => {
  const HEIGHT = ${STRIP_HEIGHT}
  const PREFIX = ${JSON.stringify(ID_PREFIX)}
  const MIN_WIDTH = 24

  const previous = document.querySelectorAll('[id^="' + PREFIX + '"]')
  previous.forEach(el => el.remove())
  if (!document.body) return 'no-body'

  const width = window.innerWidth
  const interactive = document.querySelectorAll(
    'a,button,input,select,textarea,summary,label,' +
    '[role="button"],[role="link"],[role="combobox"],[role="menuitem"],[role="tab"],' +
    '[contenteditable="true"],[tabindex]:not([tabindex="-1"])',
  )

  const spans = []
  for (const el of interactive) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (r.top >= HEIGHT || r.bottom <= 0) continue
    spans.push([Math.max(0, r.left), Math.min(width, r.right)])
  }
  spans.sort((a, b) => a[0] - b[0])

  const gaps = []
  let cursor = 0
  for (const [left, right] of spans) {
    if (left > cursor) gaps.push([cursor, left])
    if (right > cursor) cursor = right
  }
  if (cursor < width) gaps.push([cursor, width])

  let made = 0
  for (const [left, right] of gaps) {
    if (right - left < MIN_WIDTH) continue
    const strip = document.createElement('div')
    strip.id = PREFIX + made
    strip.style.cssText = [
      'position:fixed',
      'top:0',
      'left:' + left + 'px',
      'width:' + (right - left) + 'px',
      'height:' + HEIGHT + 'px',
      'z-index:2147483647',
      'pointer-events:none',
      '-webkit-app-region:drag',
    ].join(';')
    document.body.appendChild(strip)
    made++
  }
  return 'strips:' + made + ' skipped-controls:' + spans.length
})()`

async function apply(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) return
  try {
    const result = await contents.executeJavaScript(SCRIPT, true)
    log.info('[DragRegion]', result)
  }
  catch (error) {
    log.warn('[DragRegion] Could not apply:', error)
  }
}

/**
 * Recomputed after load and again as the app hydrates and renders its chrome.
 * A single pass at did-finish-load runs before the header exists.
 */
const RECHECK_DELAYS_MS = [300, 1000, 3000]

export function installDragRegionFallback(win: BrowserWindow): void {
  // Only frameless/hidden-titlebar windows need this; Linux keeps its frame.
  if (!isMac && !isWindows) return

  const contents = win.webContents
  const timers: NodeJS.Timeout[] = []

  const refresh = () => {
    void apply(contents)
    for (const delay of RECHECK_DELAYS_MS) {
      timers.push(setTimeout(() => void apply(contents), delay))
    }
  }

  refresh()
  contents.on('did-finish-load', refresh)
  // The app is a SPA, so most route changes never fire did-finish-load.
  contents.on('did-navigate-in-page', refresh)
  // Layout changes with the window, so the gaps have to be recomputed.
  win.on('resize', () => void apply(contents))

  win.on('closed', () => {
    for (const timer of timers) clearTimeout(timer)
  })
}
