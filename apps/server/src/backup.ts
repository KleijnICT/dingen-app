import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/** Zoveel kopieën blijven er in `DATA_DIR/backups` staan. */
export const KEEP_BACKUPS = 10

interface JournalEntry {
  idx: number
  when: number
  tag: string
}

export interface BackupResult {
  file: string
  from: string
  to: string
  pending: string[]
}

export interface BackupOptions {
  databasePath: string
  backupDir: string
  migrationsFolder: string
  keep?: number
  now?: Date
}

function readJournal(migrationsFolder: string): JournalEntry[] {
  const file = path.join(migrationsFolder, 'meta', '_journal.json')
  const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries: JournalEntry[] }
  return [...journal.entries].sort((a, b) => a.when - b.when)
}

/** `0004_reminders` → `0004`. */
function shortTag(tag: string): string {
  return tag.split('_')[0] ?? tag
}

/**
 * Welke migraties staan er klaar voor deze database? Volgt de regel van de
 * drizzle-migrator: alles wat nieuwer is dan de laatst toegepaste migratie.
 * Geeft null voor een lege of nieuwe database (niets om te bewaren).
 */
export function pendingMigrations(
  sqlite: Database.Database,
  migrationsFolder: string,
): { from: string; pending: JournalEntry[] } | null {
  const tables = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as { name: string }[]
  if (tables.length === 0) return null
  const journal = readJournal(migrationsFolder)
  let last: number | null = null
  if (tables.some((t) => t.name === '__drizzle_migrations')) {
    const row = sqlite
      .prepare('select created_at as at from __drizzle_migrations order by created_at desc limit 1')
      .get() as { at: number | string } | undefined
    last = row ? Number(row.at) : null
  }
  const pending = journal.filter((m) => last === null || m.when > last)
  const applied = last === null ? undefined : journal.find((m) => m.when === last)
  return { from: applied ? shortTag(applied.tag) : 'none', pending }
}

function dateStamp(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function freeName(dir: string, base: string): string {
  let file = path.join(dir, `${base}.db`)
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}.db`)
  return file
}

/** Laat alleen de `keep` nieuwste kopieën staan. */
export function pruneBackups(backupDir: string, keep = KEEP_BACKUPS): string[] {
  const files = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith('dingen-') && name.endsWith('.db'))
    .map((name) => {
      const file = path.join(backupDir, name)
      return { file, mtime: fs.statSync(file).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime || b.file.localeCompare(a.file))
  const removed = files.slice(keep).map((f) => f.file)
  for (const file of removed) fs.rmSync(file)
  return removed
}

/**
 * Maakt een kopie van de database als er migraties klaarstaan en de database
 * niet leeg is. Gooit een fout als de kopie mislukt; de aanroeper migreert dan niet.
 */
export async function backupBeforeMigrations(options: BackupOptions): Promise<BackupResult | null> {
  if (!fs.existsSync(options.databasePath)) return null
  const sqlite = new Database(options.databasePath, { fileMustExist: true })
  try {
    const state = pendingMigrations(sqlite, options.migrationsFolder)
    if (!state || state.pending.length === 0) return null
    const to = shortTag(state.pending[state.pending.length - 1]?.tag ?? '')
    fs.mkdirSync(options.backupDir, { recursive: true })
    const file = freeName(
      options.backupDir,
      `dingen-${dateStamp(options.now ?? new Date())}-${state.from}-${to}`,
    )
    try {
      await sqlite.backup(file)
    } catch (err) {
      fs.rmSync(file, { force: true })
      throw err
    }
    pruneBackups(options.backupDir, options.keep ?? KEEP_BACKUPS)
    return { file, from: state.from, to, pending: state.pending.map((m) => m.tag) }
  } finally {
    sqlite.close()
  }
}
