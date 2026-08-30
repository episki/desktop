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
const ELEMENT_ID = '__episki_drag_strip'

const SCRIPT = `(() => {
  const ID = ${JSON.stringify(ELEMENT_ID)}
  const existing = document.getElementById(ID)

  const pageHasDragRegion = Array.prototype.some.call(
    document.querySelectorAll('*'),
    el => el.id !== ID
      && getComputedStyle(el).getPropertyValue('-webkit-app-region').trim() === 'drag',
  )

  if (pageHasDragRegion) {
    if (existing) existing.remove()
    return 'page-provides-drag-region'
  }
  if (existing) return 'already-installed'
  if (!document.body) return 'no-body'

  const strip = document.createElement('div')
  strip.id = ID
  // pointer-events:none so the strip never swallows a click meant for the page;
  // Chromium still honours the drag region.
  strip.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'height:${STRIP_HEIGHT}px',
    'z-index:2147483647',
    'pointer-events:none',
    '-webkit-app-region:drag',
  ].join(';')
  document.body.appendChild(strip)
  return 'installed'
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

export function installDragRegionFallback(win: BrowserWindow): void {
  // Only frameless/hidden-titlebar windows need this; Linux keeps its frame.
  if (!isMac && !isWindows) return

  const contents = win.webContents
  void apply(contents)
  contents.on('did-finish-load', () => void apply(contents))
  // The app is a SPA, so most route changes never fire did-finish-load.
  contents.on('did-navigate-in-page', () => void apply(contents))
}
