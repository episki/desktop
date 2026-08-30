import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { HELP_URL, isDev, isMac, MARKETING_URL } from './config'
import { logFilePath } from './log'
import { checkForUpdates, updatesEnabled } from './updater'

export function createMenu(): void {
  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    enabled: updatesEnabled(),
    click: () => checkForUpdates({ userInitiated: true }),
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            checkForUpdatesItem,
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
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
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [checkForUpdatesItem, { type: 'separator' as const }]),
        {
          label: 'Learn More',
          click: () => void shell.openExternal(MARKETING_URL),
        },
        {
          label: 'Help & Support',
          click: () => void shell.openExternal(HELP_URL),
        },
        { type: 'separator' },
        {
          // The single most useful thing a user can send us when updates or
          // deep links misbehave.
          label: 'Open Log File',
          click: () => void shell.showItemInFolder(logFilePath()),
        },
        ...(isDev
          ? []
          : [{
              label: `Version ${app.getVersion()}`,
              enabled: false,
            } satisfies MenuItemConstructorOptions]),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
