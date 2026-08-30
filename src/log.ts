import log from 'electron-log/main'
import { app } from 'electron'

log.initialize()

log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? 'warn' : 'debug'
// Keep user log files small; they are only useful for recent diagnostics.
log.transports.file.maxSize = 5 * 1024 * 1024

/** Absolute path of the current log file, surfaced in the Help menu. */
export function logFilePath(): string {
  return log.transports.file.getFile().path
}

export default log
