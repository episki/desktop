import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import log from './log'

/**
 * Minimal persistent JSON store.
 *
 * This replaces `electron-store`, which went ESM-only at v9 and cannot be
 * required from this CommonJS main process. Window state is the only thing we
 * persist, so a dependency is not worth the ESM migration.
 */
export class JsonStore<T extends object> {
  private readonly file: string
  private data: T

  constructor(name: string, private readonly defaults: T) {
    this.file = path.join(app.getPath('userData'), `${name}.json`)
    this.data = this.read()
  }

  private read(): T {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      return { ...this.defaults, ...(JSON.parse(raw) as Partial<T>) }
    }
    catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        log.warn(`[Store] Could not read ${this.file}, using defaults:`, err.message)
      }
      return { ...this.defaults }
    }
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key]
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value
    this.flush()
  }

  /** Write via a temp file + rename so a crash mid-write cannot corrupt the store. */
  private flush(): void {
    const tmp = `${this.file}.tmp`
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    }
    catch (error) {
      log.error('[Store] Failed to persist:', error)
      try {
        fs.rmSync(tmp, { force: true })
      }
      catch {
        // best effort
      }
    }
  }
}
