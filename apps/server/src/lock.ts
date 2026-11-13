import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * The data directory lock: `DATA_DIR/dingen.lock`, a tiny SQLite file on
 * which the holder keeps an exclusive lock. The server holds it while it
 * runs; `dingen restore` takes it, so it refuses while the server runs and
 * the server cannot start halfway a restore.
 *
 * An SQLite lock (not a PID file or a port check) because it works wherever
 * the database itself works: across processes, across containers that share
 * the volume (`docker compose run` has its own PIDs and network), and the
 * operating system releases it when the holder stops, also after a crash.
 */
export const LOCK_FILE = 'dingen.lock'

export class DataDirLock {
  private constructor(private readonly sqlite: Database.Database) {}

  /**
   * Takes the lock. Returns null when someone else holds it; throws on other
   * problems (no write access, a file system without locks).
   */
  static acquire(dataDir: string): DataDirLock | null {
    fs.mkdirSync(dataDir, { recursive: true })
    const sqlite = new Database(path.join(dataDir, LOCK_FILE), { timeout: 0 })
    try {
      sqlite.pragma('locking_mode = EXCLUSIVE')
      sqlite.exec('BEGIN EXCLUSIVE')
    } catch (err) {
      sqlite.close()
      if ((err as { code?: string }).code === 'SQLITE_BUSY') return null
      throw err
    }
    return new DataDirLock(sqlite)
  }

  release(): void {
    if (!this.sqlite.open) return
    try {
      this.sqlite.exec('ROLLBACK')
    } catch {
      // Closing releases it anyway.
    }
    this.sqlite.close()
  }
}
