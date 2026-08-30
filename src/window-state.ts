import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { JsonStore } from './store'
import log from './log'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
  isFullScreen: boolean
}

const DEFAULTS: WindowState = {
  width: 1400,
  height: 900,
  x: undefined,
  y: undefined,
  isMaximized: false,
  isFullScreen: false,
}

const SAVE_DEBOUNCE_MS = 400

let store: JsonStore<{ windowState: WindowState }> | null = null

function getStore() {
  if (!store) {
    store = new JsonStore('window-state', { windowState: { ...DEFAULTS } })
  }
  return store
}

/**
 * True when the saved position still lands on a connected display. Without this
 * the window restores off-screen after a monitor is unplugged.
 */
function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    // Require a reasonable slice of the title bar to be reachable by the cursor.
    const visibleX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const visibleY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return visibleX >= 100 && visibleY >= 50
  })
}

/** Restore persisted geometry, clamped to the current display layout. */
export function restoreWindowState(): WindowState {
  const saved = { ...DEFAULTS, ...getStore().get('windowState') }

  const centered = (width: number, height: number): WindowState => {
    const primary = screen.getPrimaryDisplay().workArea
    return {
      ...saved,
      width: Math.min(width, primary.width),
      height: Math.min(height, primary.height),
      x: undefined,
      y: undefined,
    }
  }

  if (saved.x === undefined || saved.y === undefined) {
    return centered(saved.width, saved.height)
  }

  // Pick the display from the saved geometry, then clamp to it, and only then
  // test visibility. Testing first would let a window pass on its original
  // width and then be clamped until it no longer intersects any display.
  const savedBounds: Rectangle = {
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
  }
  const target = screen.getDisplayMatching(savedBounds).workArea
  const width = Math.min(saved.width, target.width)
  const height = Math.min(saved.height, target.height)

  const finalBounds: Rectangle = { x: saved.x, y: saved.y, width, height }
  if (!isVisibleOnSomeDisplay(finalBounds)) {
    log.info('[WindowState] Saved position is off-screen, centering instead')
    return centered(width, height)
  }

  return { ...saved, width, height }
}

/**
 * Persist geometry on resize/move/maximize. Saves are debounced because those
 * events fire continuously while dragging, and each save is a disk write.
 */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const persist = () => {
    if (win.isDestroyed()) return
    // getNormalBounds() is the un-maximized geometry; getBounds() would save the
    // maximized size and leave the window screen-sized after un-maximizing.
    const bounds = win.getNormalBounds()
    getStore().set('windowState', {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
    })
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, SAVE_DEBOUNCE_MS)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('enter-full-screen', schedule)
  win.on('leave-full-screen', schedule)

  // Flush synchronously on close so the final position is not lost to the debounce.
  win.on('close', () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    persist()
  })
}
