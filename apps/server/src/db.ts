import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))
/** De map met SQL-migraties en `meta/_journal.json`. */
export const migrationsFolder = path.join(here, '../drizzle')

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenedDatabase {
  db: Db
  sqlite: Database.Database
  sqliteVersion: string
  close: () => void
}

/**
 * Opent (of maakt) de SQLite-database en voert openstaande migraties uit.
 * Gebruik ':memory:' voor tests. Draai bij een bestaande database eerst
 * `backupBeforeMigrations` (zie backup.ts), of gebruik `prepareDatabase` (startup.ts).
 * Faalt een migratie, dan is de verbinding gesloten voordat de fout komt.
 */
export function openDatabase(
  filePath: string,
  options: { migrationsFolder?: string } = {},
): OpenedDatabase {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  try {
    migrate(db, { migrationsFolder: options.migrationsFolder ?? migrationsFolder })
  } catch (err) {
    // Closed, so the caller can put a back-up in its place (see startup.ts).
    sqlite.close()
    throw err
  }
  const row = sqlite.prepare('select sqlite_version() as v').get() as { v: string }
  return {
    db,
    sqlite,
    sqliteVersion: row.v,
    close: () => sqlite.close(),
  }
}
