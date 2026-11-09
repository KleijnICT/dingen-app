import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.join(here, '../drizzle')

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenedDatabase {
  db: Db
  sqlite: Database.Database
  sqliteVersion: string
  close: () => void
}

/**
 * Opent (of maakt) de SQLite-database en voert openstaande migraties uit.
 * Gebruik ':memory:' voor tests.
 */
export function openDatabase(filePath: string): OpenedDatabase {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  const row = sqlite.prepare('select sqlite_version() as v').get() as { v: string }
  return {
    db,
    sqlite,
    sqliteVersion: row.v,
    close: () => sqlite.close(),
  }
}
