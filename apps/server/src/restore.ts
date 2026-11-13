import fs from 'node:fs'
import Database from 'better-sqlite3'
import { schemaState } from './backup.js'

/**
 * Putting a back-up in place of the database (plan 24): by the command line
 * (`dingen restore`) and by the server itself when a migration fails.
 *
 * Sync after a restore: clients may have seen changes the back-up does not
 * have, so their cursor lies beyond the log. As long as nothing new is
 * written, the server sees that (cursor above the highest `seq`). To keep
 * recognising it after new writes, a restore records the range of `seq`
 * values that were lost (`CURSOR_GAPS_KEY` in `meta`) and lets new changes
 * continue numbering after the replaced database's highest `seq`, so a cursor
 * in a lost range never becomes valid again. See `SyncService.pullSpaces`.
 */

/** The `meta` key with the lost `seq` ranges, a JSON array of `CursorGap`. */
export const CURSOR_GAPS_KEY = 'sync.cursor_gaps'

/** Cursors with `after < seq <= upTo` come from a database that was replaced. */
export interface CursorGap {
  after: number
  upTo: number
}

export class RestoreError extends Error {}

/** The tables every Dingen database has; a file without them is not one. */
const REQUIRED_TABLES = ['__drizzle_migrations', 'meta', 'users', 'entities', 'changes']

function hasTable(sqlite: Database.Database, name: string): boolean {
  return !!sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name)
}

export function readGaps(sqlite: Database.Database): CursorGap[] {
  if (!hasTable(sqlite, 'meta')) return []
  const row = sqlite.prepare('select value from meta where key = ?').get(CURSOR_GAPS_KEY) as
    | { value: string }
    | undefined
  if (!row) return []
  try {
    const value: unknown = JSON.parse(row.value)
    if (!Array.isArray(value)) return []
    return value.filter(
      (g): g is CursorGap =>
        !!g && typeof g === 'object' && Number.isInteger(g.after) && Number.isInteger(g.upTo),
    )
  } catch {
    return []
  }
}

/** The highest `seq` the database handed out (or will continue after). */
function highestSeq(sqlite: Database.Database): number {
  if (!hasTable(sqlite, 'changes')) return 0
  const row = sqlite.prepare('select max(seq) as seq from changes').get() as { seq: number | null }
  let seq = row.seq ?? 0
  if (hasTable(sqlite, 'sqlite_sequence')) {
    const counter = sqlite
      .prepare("select seq from sqlite_sequence where name = 'changes'")
      .get() as { seq: number } | undefined
    seq = Math.max(seq, counter?.seq ?? 0)
  }
  return seq
}

/** The highest `seq` actually in the log (what a client can have seen). */
function lastLogged(sqlite: Database.Database): number {
  if (!hasTable(sqlite, 'changes')) return 0
  const row = sqlite.prepare('select max(seq) as seq from changes').get() as { seq: number | null }
  return row.seq ?? 0
}

/**
 * Checks that a file is a Dingen database this version can run: an SQLite
 * file that passes `quick_check`, with Dingen's tables, and a schema no newer
 * than this build's migrations. Throws a `RestoreError` that says why not.
 */
export function checkDingenDatabase(sqlite: Database.Database, migrationsFolder: string): string {
  let ok: string
  try {
    ok = String(sqlite.pragma('quick_check', { simple: true }))
  } catch (err) {
    throw new RestoreError(
      `not an SQLite database (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (ok !== 'ok') throw new RestoreError(`the database is damaged (quick_check: ${ok})`)
  const missing = REQUIRED_TABLES.filter((t) => !hasTable(sqlite, t))
  if (missing.length > 0) {
    throw new RestoreError(`not a Dingen database (missing tables: ${missing.join(', ')})`)
  }
  const state = schemaState(sqlite, migrationsFolder)
  if (state.newer) {
    throw new RestoreError(
      'the back-up comes from a newer version of Dingen (its schema is newer than this version knows); restore it with that version',
    )
  }
  if (state.unknown) {
    throw new RestoreError(
      'the back-up has a schema version this version of Dingen does not know (a development build?)',
    )
  }
  return state.version
}

export interface ReplaceOptions {
  /** Check the file first (`checkDingenDatabase`); off for the server's own fallback. */
  check?: { migrationsFolder: string }
}

export interface ReplaceResult {
  /** The schema version of the restored database, when checked. */
  schema: string | null
  /** The lost `seq` range recorded for the sync, or null when nothing was lost. */
  gap: CursorGap | null
}

function removeSidecars(file: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(`${file}${suffix}`, { force: true })
}

/**
 * Puts `source` (a back-up) in place of the database at `databasePath`.
 * Nobody may have the database open: the caller closed its connection (the
 * server's fallback) or holds the data directory lock (`dingen restore`).
 *
 * The back-up is copied next to the database first and prepared there (a
 * plain rollback journal; the lost `seq` range noted, see above), so the swap
 * itself is one rename. The old database's `-wal` and `-shm` go first: a
 * stale write-ahead log must never be applied to the restored file.
 */
export function replaceDatabase(
  databasePath: string,
  source: string,
  options: ReplaceOptions = {},
): ReplaceResult {
  if (!fs.existsSync(source)) throw new RestoreError(`${source} does not exist`)
  const tmp = `${databasePath}.restoring`
  fs.rmSync(tmp, { force: true })
  removeSidecars(tmp)

  // What the current database handed out, so the restored one continues after it.
  let current: { seq: number; gaps: CursorGap[] } | null = null
  if (fs.existsSync(databasePath)) {
    try {
      const db = new Database(databasePath, { fileMustExist: true })
      try {
        current = { seq: highestSeq(db), gaps: readGaps(db) }
      } finally {
        db.close()
      }
    } catch {
      // Unreadable (damaged): nothing to continue after.
      current = null
    }
  }

  fs.copyFileSync(source, tmp)
  let result: ReplaceResult
  try {
    let restored: Database.Database
    try {
      restored = new Database(tmp, { fileMustExist: true })
    } catch (err) {
      throw new RestoreError(
        `cannot open ${source} (${err instanceof Error ? err.message : String(err)})`,
      )
    }
    try {
      const schema = options.check
        ? checkDingenDatabase(restored, options.check.migrationsFolder)
        : null
      restored.pragma('journal_mode = DELETE')
      result = { schema, gap: null }
      const last = lastLogged(restored)
      if (current && hasTable(restored, 'changes') && current.seq > highestSeq(restored)) {
        const gap = { after: last, upTo: current.seq }
        const gaps = [...readGaps(restored)]
        for (const g of [...current.gaps, gap]) {
          if (!gaps.some((x) => x.after === g.after && x.upTo === g.upTo)) gaps.push(g)
        }
        restored.transaction(() => {
          if (hasTable(restored, 'meta')) {
            restored
              .prepare(
                'insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
              )
              .run(CURSOR_GAPS_KEY, JSON.stringify(gaps))
          }
          // New changes are numbered after everything the old database handed out.
          const updated = restored
            .prepare("update sqlite_sequence set seq = ? where name = 'changes'")
            .run(current.seq)
          if (updated.changes === 0) {
            restored
              .prepare("insert into sqlite_sequence (name, seq) values ('changes', ?)")
              .run(current.seq)
          }
        })()
        result.gap = gap
      }
    } finally {
      restored.close()
    }
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    removeSidecars(tmp)
    throw err
  }

  removeSidecars(databasePath)
  fs.renameSync(tmp, databasePath)
  return result
}
