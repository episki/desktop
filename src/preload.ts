import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,

  // Window controls for Windows/Linux frameless
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    ipcRenderer.on('window-maximized-change', (_event, maximized) => {
      callback(maximized)
    })
  },

  // OAuth deep link callback URL
  getAuthCallbackUrl: () => 'episki://auth/callback',

  // Deep link handler for OAuth callbacks
  onDeepLink: (callback: (data: { url: string; path: string }) => void) => {
    ipcRenderer.on('deep-link', (_event, data) => {
      callback(data)
    })
  },

  // Theme sync
  onThemeUpdated: (callback: (theme: { shouldUseDarkColors: boolean; themeSource: string }) => void) => {
    ipcRenderer.on('theme-updated', (_event, theme) => {
      callback(theme)
    })
  },

  // Auto-updater
  onUpdateAvailable: (callback: (info: any) => void) => {
    ipcRenderer.on('update-available', (_event, info) => {
      callback(info)
    })
  },
  onUpdateDownloadProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('update-download-progress', (_event, progress) => {
      callback(progress)
    })
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    ipcRenderer.on('update-downloaded', (_event, info) => {
      callback(info)
    })
  },
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
})
