import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * Back-ups in `DATA_DIR/backups` (plan 24). Every back-up is a complete,
 * self-contained SQLite file made with the SQLite backup API, so it is
 * consistent even while the server writes. The file name tells what it is:
 *
 *   dingen-<kind>-<YYYY-MM-DD>T<HHMMSS>Z-<schema>.db
 *
 * with the kind (see `BackupKind`), the moment in UTC and the schema version
 * of the database (the last applied SQL migration, e.g. `0008`). Files from
 * before this scheme (`dingen-<date>-<from>-<to>.db`) count as `pre-update`.
 */

/** What made a back-up. */
export type BackupKind = 'daily' | 'pre-update' | 'pre-restore' | 'manual'

export const BACKUP_KINDS: readonly BackupKind[] = ['daily', 'pre-update', 'pre-restore', 'manual']

/** How many back-ups stay (see `planRetention`). Manual back-ups are never removed. */
export interface RetentionPolicy {
  /** The newest daily back-ups. */
  daily: number
  /** The newest daily back-up of each of this many most recent ISO weeks. */
  weekly: number
  /** The newest daily back-up of each of this many most recent months. */
  monthly: number
  /** The newest back-ups made before an update (migrations). */
  preUpdate: number
  /** The newest back-ups made before a restore. */
  preRestore: number
}

export const RETENTION: RetentionPolicy = {
  daily: 7,
  weekly: 4,
  monthly: 3,
  preUpdate: 10,
  preRestore: 10,
}

/** The pre-update rule from before plan 24; kept as a name. */
export const KEEP_BACKUPS = RETENTION.preUpdate

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
  /** Also back up when no SQL migration is pending but this says so (data migrations). */
  alsoWhen?: (sqlite: Database.Database) => boolean
  policy?: RetentionPolicy
  now?: Date
}

export function readJournal(migrationsFolder: string): JournalEntry[] {
  const file = path.join(migrationsFolder, 'meta', '_journal.json')
  const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries: JournalEntry[] }
  return [...journal.entries].sort((a, b) => a.when - b.when)
}

/** `0004_reminders` → `0004`. */
function shortTag(tag: string): string {
  return tag.split('_')[0] ?? tag
}

/** The schema version this build migrates to (`0008`). */
export function latestSchema(migrationsFolder: string): string {
  return shortTag(readJournal(migrationsFolder).at(-1)?.tag ?? 'none')
}

export interface SchemaState {
  /** The short tag of the last applied migration (`0008`), `none` without any. */
  version: string
  /** The `created_at` of the last applied migration, or null. */
  appliedAt: number | null
  /** Applied migrations this build does not know, after its last one: a newer version. */
  newer: boolean
  /** The last applied migration is not in this build's journal at all. */
  unknown: boolean
}

function hasTable(sqlite: Database.Database, name: string): boolean {
  return !!sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name)
}

/** Which schema version a database has, compared with this build's migrations. */
export function schemaState(sqlite: Database.Database, migrationsFolder: string): SchemaState {
  const journal = readJournal(migrationsFolder)
  let last: number | null = null
  if (hasTable(sqlite, '__drizzle_migrations')) {
    const row = sqlite
      .prepare('select created_at as at from __drizzle_migrations order by created_at desc limit 1')
      .get() as { at: number | string } | undefined
    last = row ? Number(row.at) : null
  }
  if (last === null) return { version: 'none', appliedAt: null, newer: false, unknown: false }
  const applied = journal.find((m) => m.when === last)
  const newest = journal.at(-1)?.when ?? 0
  return {
    version: applied ? shortTag(applied.tag) : 'unknown',
    appliedAt: last,
    newer: last > newest,
    unknown: !applied,
  }
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
  const state = schemaState(sqlite, migrationsFolder)
  const pending = readJournal(migrationsFolder).filter(
    (m) => state.appliedAt === null || m.when > state.appliedAt,
  )
  return { from: state.version, pending }
}

/** `2026-11-13T030512Z`: sortable, safe in file names on every system. */
function stamp(now: Date): string {
  return `${now.toISOString().slice(0, 19).replace(/:/g, '')}Z`
}

const NAME =
  /^dingen-(daily|pre-update|pre-restore|manual)-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-z]+)(?:-\d+)?\.db$/
const LEGACY_NAME = /^dingen-(\d{4}-\d{2}-\d{2})-([0-9a-z]+)-([0-9a-z]+)(?:-\d+)?\.db$/

export interface ParsedName {
  kind: BackupKind
  /** The moment from the name; null for old names (use the file's time). */
  at: Date | null
  schema: string
}

/** Reads a back-up file name; null for files that are not back-ups. */
export function parseBackupName(name: string): ParsedName | null {
  const m = NAME.exec(name)
  if (m) {
    const [, kind, date, hh, mm, ss, schema] = m
    return {
      kind: kind as BackupKind,
      at: new Date(`${date}T${hh}:${mm}:${ss}Z`),
      schema: schema ?? '',
    }
  }
  const legacy = LEGACY_NAME.exec(name)
  if (legacy) return { kind: 'pre-update', at: null, schema: legacy[2] ?? '' }
  return null
}

export function backupName(kind: BackupKind, schema: string, now: Date): string {
  return `dingen-${kind}-${stamp(now)}-${schema}`
}

function freeName(dir: string, base: string): string {
  let file = path.join(dir, `${base}.db`)
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}.db`)
  return file
}

export interface BackupEntry {
  name: string
  kind: BackupKind
  at: Date
}

export interface BackupFile extends BackupEntry {
  file: string
  schema: string
  size: number
}

/** The back-ups in a directory, newest first. Other files are left out. */
export function listBackups(backupDir: string): BackupFile[] {
  if (!fs.existsSync(backupDir)) return []
  const out: BackupFile[] = []
  for (const name of fs.readdirSync(backupDir)) {
    const parsed = parseBackupName(name)
    if (!parsed) continue
    const file = path.join(backupDir, name)
    const stat = fs.statSync(file)
    if (!stat.isFile()) continue
    out.push({
      name,
      file,
      kind: parsed.kind,
      at: parsed.at ?? stat.mtime,
      schema: parsed.schema,
      size: stat.size,
    })
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime() || b.name.localeCompare(a.name))
}

/** `2026-W46`: the ISO week (in UTC) of a moment. */
export function isoWeek(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const day = d.getUTCDay() || 7
  // The Thursday of this week decides the year.
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Which back-ups to keep and which to remove (pure). Daily: the `daily`
 * newest, plus the newest of each of the `weekly` most recent ISO weeks and of
 * each of the `monthly` most recent months. Pre-update and pre-restore: the
 * newest few. Manual: always kept.
 */
export function planRetention(
  entries: readonly BackupEntry[],
  policy: RetentionPolicy = RETENTION,
): { keep: string[]; remove: string[] } {
  const newest = (kind: BackupKind) =>
    entries
      .filter((e) => e.kind === kind)
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.name.localeCompare(a.name))
  const keep = new Set<string>()
  for (const e of entries) if (e.kind === 'manual') keep.add(e.name)
  for (const e of newest('pre-update').slice(0, policy.preUpdate)) keep.add(e.name)
  for (const e of newest('pre-restore').slice(0, policy.preRestore)) keep.add(e.name)

  const daily = newest('daily')
  for (const e of daily.slice(0, policy.daily)) keep.add(e.name)
  const firstOfEach = (key: (at: Date) => string, count: number) => {
    const seen = new Set<string>()
    for (const e of daily) {
      const k = key(e.at)
      if (seen.has(k)) continue
      if (seen.size === count) break
      seen.add(k)
      keep.add(e.name)
    }
  }
  firstOfEach(isoWeek, policy.weekly)
  firstOfEach((at) => at.toISOString().slice(0, 7), policy.monthly)

  return {
    keep: entries.filter((e) => keep.has(e.name)).map((e) => e.name),
    remove: entries.filter((e) => !keep.has(e.name)).map((e) => e.name),
  }
}

/** Removes the back-ups `planRetention` does not keep; returns their paths. */
export function pruneBackups(backupDir: string, policy: RetentionPolicy = RETENTION): string[] {
  const files = listBackups(backupDir)
  const { remove } = planRetention(files, policy)
  const removed: string[] = []
  for (const name of remove) {
    const file = path.join(backupDir, name)
    fs.rmSync(file, { force: true })
    removed.push(file)
  }
  return removed
}

/**
 * Writes a consistent copy of an open database with the SQLite backup API
 * (safe while others write). The copy is written under a temporary name and
 * set to a plain rollback journal, so a back-up is always one complete file;
 * then it gets its final name. Returns the path.
 */
export async function writeBackup(
  source: Database.Database,
  options: { backupDir: string; kind: BackupKind; schema: string; now?: Date },
): Promise<string> {
  fs.mkdirSync(options.backupDir, { recursive: true })
  const file = freeName(
    options.backupDir,
    backupName(options.kind, options.schema, options.now ?? new Date()),
  )
  const partial = `${file}.partial`
  try {
    await source.backup(partial)
    const copy = new Database(partial)
    try {
      copy.pragma('journal_mode = DELETE')
    } finally {
      copy.close()
    }
    fs.renameSync(partial, file)
  } catch (err) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      fs.rmSync(`${partial}${suffix}`, { force: true })
    }
    throw err
  }
  return file
}

/**
 * Maakt een kopie van de database als er migraties klaarstaan (of `alsoWhen`
 * zegt dat er iets anders moet draaien) en de database niet leeg is. Gooit een
 * fout als de kopie mislukt; de aanroeper migreert dan niet.
 */
export async function backupBeforeMigrations(options: BackupOptions): Promise<BackupResult | null> {
  if (!fs.existsSync(options.databasePath)) return null
  const sqlite = new Database(options.databasePath, { fileMustExist: true })
  try {
    const state = pendingMigrations(sqlite, options.migrationsFolder)
    if (!state) return null
    if (state.pending.length === 0 && !options.alsoWhen?.(sqlite)) return null
    const to = state.pending.length > 0 ? shortTag(state.pending.at(-1)?.tag ?? '') : state.from
    const file = await writeBackup(sqlite, {
      backupDir: options.backupDir,
      kind: 'pre-update',
      schema: state.from,
      ...(options.now ? { now: options.now } : {}),
    })
    pruneBackups(options.backupDir, options.policy ?? RETENTION)
    return { file, from: state.from, to, pending: state.pending.map((m) => m.tag) }
  } finally {
    sqlite.close()
  }
}
