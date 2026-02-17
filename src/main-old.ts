// Force esbuild to require the whole module
import * as Electron from 'electron'
const { app, BrowserWindow, shell, ipcMain, Menu, nativeTheme } = Electron as any
import path from 'node:path'
import { platform } from 'node:os'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { config } from 'dotenv'

// Load environment variables from .env file
config()

// __dirname and __filename are automatically available in CommonJS

const isMac = platform() === 'darwin'
const isWindows = platform() === 'win32'
const isDev = process.env.NODE_ENV === 'development'

// Environment-based URL configuration
const APP_URL = process.env.APP_URL || (isDev ? 'http://localhost:3000' : 'https://episki.app')

// Define store schema
interface StoreSchema {
  windowState: {
    width: number
    height: number
    x?: number
    y?: number
    isMaximized: boolean
  }
}

// Initialize store for persisting window state and preferences
const store = new Store<StoreSchema>({
  defaults: {
    windowState: {
      width: 1400,
      height: 900,
      x: undefined,
      y: undefined,
      isMaximized: false,
    },
  },
})

let mainWindow: any | null = null

// Register episki:// protocol as default handler
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('episki', process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient('episki')
}

// Single instance lock for Windows/Linux deep linking
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // Handle deep links when app is already running (Windows/Linux)
  app.on('second-instance', (_event, commandLine) => {
    // commandLine is an array of command line arguments
    // The deep link URL will be the last argument
    const url = commandLine.find((arg) => arg.startsWith('episki://'))
    if (url) {
      handleDeepLink(url)
    }

    // Focus the window if it exists
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Store pending deep link if window isn't ready yet
let pendingDeepLink: string | null = null

// Create native application menu
function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [
              { role: 'close' as const },
            ]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://episki.app')
          },
        },
        {
          label: 'Help & Support',
          click: async () => {
            await shell.openExternal('https://intercom.help/episki/en/')
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Handle deep link URLs
function handleDeepLink(url: string) {
  console.log('[Deep Link] Received:', url)

  if (!mainWindow) {
    console.log('[Deep Link] Window not ready, storing for later')
    pendingDeepLink = url
    return
  }

  try {
    // Parse the deep link URL (e.g., episki://auth/callback?code=...)
    const parsed = new URL(url)
    const path = parsed.pathname + parsed.search + parsed.hash

    console.log('[Deep Link] Loading path:', path)

    // Load the path in the main window
    mainWindow.loadURL(APP_URL + path)
    pendingDeepLink = null
  } catch (error) {
    console.error('[Deep Link] Failed to parse:', error)
  }
}

function createWindow() {
  // Restore window state from store
  const windowState = (store as any).get('windowState')

  const win = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1024,
    minHeight: 700,

    // macOS: hidden title bar with native traffic lights
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,

    // Windows: frameless for custom title bar
    frame: isWindows ? false : true,

    backgroundColor: '#ffffff',
    show: false,
    icon: path.join(__dirname, '../icons/png/256x256.png'),

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow = win

  // Restore maximized state
  if (windowState.isMaximized) {
    win.maximize()
  }

  // Save window state on resize, move, and maximize/unmaximize
  const saveWindowState = () => {
    const bounds = win.getBounds()
    ;(store as any).set('windowState', {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    })
  }

  win.on('resize', saveWindowState)
  win.on('move', saveWindowState)
  win.on('maximize', saveWindowState)
  win.on('unmaximize', saveWindowState)

  win.loadURL(APP_URL)

  // Show window when ready to avoid white flash
  win.once('ready-to-show', () => {
    win.show()

    // Handle any pending deep link that came in before window was ready
    if (pendingDeepLink) {
      console.log('[Deep Link] Processing pending deep link:', pendingDeepLink)
      handleDeepLink(pendingDeepLink)
    }
  })

  if (isDev) {
    win.webContents.openDevTools()
  }

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // Intercept navigation to external URLs
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // IPC handlers for window controls (Windows/Linux frameless)
  ipcMain.on('window-minimize', () => win.minimize())
  ipcMain.on('window-maximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on('window-close', () => win.close())
  ipcMain.handle('window-is-maximized', () => win.isMaximized())

  win.on('maximize', () => {
    win.webContents.send('window-maximized-change', true)
  })
  win.on('unmaximize', () => {
    win.webContents.send('window-maximized-change', false)
  })

  // Sync OS theme changes to the app
  nativeTheme.on('updated', () => {
    win.webContents.send('theme-updated', {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      themeSource: nativeTheme.themeSource,
    })
  })
}

// Configure auto-updater
function setupAutoUpdater() {
  if (isDev) {
    console.log('[Auto-Updater] Disabled in development mode')
    return
  }

  // Don't automatically download updates
  autoUpdater.autoDownload = false

  autoUpdater.on('checking-for-update', () => {
    console.log('[Auto-Updater] Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[Auto-Updater] Update available:', info.version)
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info)
    }
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[Auto-Updater] No updates available')
  })

  autoUpdater.on('error', (err) => {
    console.error('[Auto-Updater] Error:', err)
  })

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-download-progress', progress)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Auto-Updater] Update downloaded:', info.version)
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info)
    }
  })

  // Check for updates on startup (after 5 seconds)
  setTimeout(() => {
    autoUpdater.checkForUpdates()
  }, 5000)

  // Check for updates every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates()
  }, 4 * 60 * 60 * 1000)
}

// IPC handlers for auto-updater
ipcMain.on('download-update', () => {
  autoUpdater.downloadUpdate()
})

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall()
})

// macOS about panel
if (isMac) {
  app.setAboutPanelOptions({
    applicationName: 'episki',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright (c) episki',
  })
}

app.whenReady().then(() => {
  // Create native application menu
  createMenu()

  // Set up auto-updater
  setupAutoUpdater()

  if (isMac && app.dock) {
    app.dock.setIcon(path.join(__dirname, '../icons/png/256x256.png'))
  }
  createWindow()

  // On macOS, check if we were launched via a deep link
  // (the URL might have been passed as a command line argument)
  if (isMac && process.argv.length >= 2) {
    const deepLinkUrl = process.argv.find((arg) => arg.startsWith('episki://'))
    if (deepLinkUrl) {
      console.log('[Deep Link] Found deep link on launch:', deepLinkUrl)
      handleDeepLink(deepLinkUrl)
    }
  }
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Handle deep links on macOS (open-url event)
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})
