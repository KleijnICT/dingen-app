import type Database from 'better-sqlite3'
import { type BackupResult, backupBeforeMigrations } from './backup.js'
import { type Db, type OpenedDatabase, openDatabase } from './db.js'
import { replaceDatabase } from './restore.js'
import { LOWERCASE_TAGS_KEY, migrateLowercaseTags } from './tags/lowercase.js'

/**
 * A data migration: a one-time change to the data that must go through the
 * change log (so clients sync it), run at start after the SQL migrations. It
 * records in `meta` under `key` that it ran; `run` returns a line for the log
 * (or null).
 */
export interface DataMigration {
  key: string
  name: string
  run: (db: Db) => string | null
}

export const DATA_MIGRATIONS: DataMigration[] = [
  {
    key: LOWERCASE_TAGS_KEY,
    name: 'tags to lowercase',
    run: (db) => {
      const tags = migrateLowercaseTags(db)
      return tags && tags.spaces > 0
        ? `Tags to lowercase: ${tags.renamed} renamed, ${tags.merged} merged, ${tags.retagged} tasks and projects re-tagged in ${tags.spaces} space(s)`
        : null
    },
  },
]

/** Starting cannot go on; `message` says why and what to do. Exit non-zero. */
export class StartupError extends Error {}

export interface PrepareOptions {
  databasePath: string
  backupDir: string
  migrationsFolder: string
  dataMigrations?: DataMigration[]
  log?: Pick<Console, 'log' | 'error'>
  now?: Date
}

function hasKey(sqlite: Database.Database, key: string): boolean {
  const table = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'meta'")
    .get()
  return !!table && !!sqlite.prepare('select 1 from meta where key = ?').get(key)
}

function done(db: OpenedDatabase, key: string): boolean {
  return !!db.sqlite.prepare('select 1 from meta where key = ?').get(key)
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Opens the database for the server, safely (plan 24, part A):
 *
 * 1. When SQL migrations or data migrations still have to run on an existing
 *    database, a back-up first (`pre-update`). If that fails: no start.
 * 2. SQL migrations, then the data migrations that have not run yet.
 * 3. If one of them fails, the database is put back to that back-up (the
 *    server is not listening yet, so nobody saw the half-done state) and a
 *    `StartupError` says which step failed, which file came back, and to
 *    start the previous version.
 */
export async function prepareDatabase(options: PrepareOptions): Promise<OpenedDatabase> {
  const migrations = options.dataMigrations ?? DATA_MIGRATIONS
  const log = options.log ?? console

  let backup: BackupResult | null
  try {
    backup = await backupBeforeMigrations({
      databasePath: options.databasePath,
      backupDir: options.backupDir,
      migrationsFolder: options.migrationsFolder,
      alsoWhen: (sqlite) => migrations.some((m) => !hasKey(sqlite, m.key)),
      ...(options.now ? { now: options.now } : {}),
    })
  } catch (err) {
    throw new StartupError(
      `Could not back up the database before migrating; not starting. ${message(err)}\nCheck free disk space and write access to ${options.backupDir}.`,
    )
  }
  if (backup) {
    log.log(
      backup.pending.length > 0
        ? `Database migration ${backup.from} → ${backup.to}: backup written to ${backup.file}`
        : `Data migration pending: backup written to ${backup.file}`,
    )
  }

  const fail = (step: string, err: unknown): never => {
    const reason = `${step} failed: ${message(err)}`
    if (!backup) {
      throw new StartupError(
        `${reason}\nThere was no backup to go back to (a new or empty database). Not starting.`,
      )
    }
    try {
      replaceDatabase(options.databasePath, backup.file)
    } catch (restoreErr) {
      throw new StartupError(
        `${reason}\nPutting back the backup ${backup.file} failed too: ${message(restoreErr)}\nNot starting. Stop Dingen, copy that backup to ${options.databasePath} by hand (removing ${options.databasePath}-wal and -shm) and start the previous version.`,
      )
    }
    throw new StartupError(
      `${reason}\nThe database was restored to ${backup.file}; it is as it was before this update. Start the previous version of Dingen and report the problem.`,
    )
  }

  let opened: OpenedDatabase
  try {
    opened = openDatabase(options.databasePath, { migrationsFolder: options.migrationsFolder })
  } catch (err) {
    const which =
      backup && backup.pending.length > 0
        ? `Database migration ${backup.from} → ${backup.to} (${backup.pending.join(', ')})`
        : 'Database migration'
    return fail(which, err)
  }

  for (const migration of migrations) {
    if (done(opened, migration.key)) continue
    try {
      const line = migration.run(opened.db)
      if (line) log.log(line)
    } catch (err) {
      opened.close()
      return fail(`Data migration "${migration.name}"`, err)
    }
  }
  return opened
}
