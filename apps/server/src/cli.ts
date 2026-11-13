import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { latestSchema, listBackups, pruneBackups, schemaState, writeBackup } from './backup.js'
import { type Config, loadConfig } from './config.js'
import { migrationsFolder } from './db.js'
import { DataDirLock } from './lock.js'
import { RestoreError, replaceDatabase } from './restore.js'

/**
 * The `dingen` command (plan 24): back-ups from the command line, also when
 * the app does not start. In the Docker image: `docker compose exec dingen
 * dingen backup`; elsewhere `node apps/server/dist/cli.js backup`. Uses
 * DATA_DIR like the server.
 */

const USAGE = `Usage: dingen <command>

  backup            Make a backup now (also while the server runs)
  backups           List the backups in DATA_DIR/backups
  restore <file>    Put a backup back as the database (only with the server stopped;
                    the current database is backed up first)
  help              Show this help`

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

const consoleIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function localTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)
}

function hasData(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).size > 0
}

async function backup(config: Config, io: CliIo): Promise<number> {
  if (!hasData(config.databasePath)) {
    io.err(`No database at ${config.databasePath}; nothing to back up.`)
    return 1
  }
  const sqlite = new Database(config.databasePath, { fileMustExist: true })
  try {
    const file = await writeBackup(sqlite, {
      backupDir: config.backupDir,
      kind: 'manual',
      schema: schemaState(sqlite, migrationsFolder).version,
    })
    pruneBackups(config.backupDir)
    io.out(`Backup written to ${file}`)
    return 0
  } finally {
    sqlite.close()
  }
}

function list(config: Config, io: CliIo): number {
  const files = listBackups(config.backupDir)
  if (files.length === 0) {
    io.out(`No backups in ${config.backupDir}.`)
    return 0
  }
  const rows = files.map((b) => [
    b.name,
    b.kind,
    localTime(b.at, config.timezone),
    b.schema,
    size(b.size),
  ])
  const header = ['File', 'Kind', `Date (${config.timezone})`, 'Schema', 'Size']
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)))
  const line = (cells: string[]) =>
    cells
      .map((c, i) =>
        i === cells.length - 1 ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0),
      )
      .join('  ')
  io.out(line(header))
  for (const row of rows) io.out(line(row))
  io.out(
    `\n${files.length} backup(s) in ${config.backupDir}; this version has schema ${latestSchema(migrationsFolder)}.`,
  )
  return 0
}

/** A bare name or a path; a name is looked up in the backup directory too. */
function resolveBackup(arg: string, config: Config): string | null {
  const candidates = [path.resolve(arg), path.join(config.backupDir, arg)]
  return candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) ?? null
}

async function restore(arg: string | undefined, config: Config, io: CliIo): Promise<number> {
  if (!arg) {
    io.err('Which backup? Usage: dingen restore <file> (see `dingen backups`).')
    return 2
  }
  const source = resolveBackup(arg, config)
  if (!source) {
    io.err(`Backup not found: ${arg} (looked in the current directory and ${config.backupDir}).`)
    return 1
  }

  let lock: DataDirLock | null
  try {
    lock = DataDirLock.acquire(config.dataDir)
  } catch (err) {
    io.err(
      `Could not lock ${config.dataDir}: ${err instanceof Error ? err.message : String(err)}. Not restoring.`,
    )
    return 1
  }
  if (!lock) {
    io.err(
      'Dingen is running (the data directory is locked). Stop the server first, then restore; with Docker: `docker compose stop dingen`, then `docker compose run --rm dingen dingen restore <file>`.',
    )
    return 1
  }

  try {
    if (hasData(config.databasePath)) {
      const sqlite = new Database(config.databasePath, { fileMustExist: true })
      let current: string
      try {
        current = await writeBackup(sqlite, {
          backupDir: config.backupDir,
          kind: 'pre-restore',
          schema: schemaState(sqlite, migrationsFolder).version,
        })
      } finally {
        sqlite.close()
      }
      io.out(`The current database is saved as ${current}`)
    }
    const result = replaceDatabase(config.databasePath, source, { check: { migrationsFolder } })
    pruneBackups(config.backupDir)
    io.out(`Restored ${source} (schema ${result.schema}) to ${config.databasePath}.`)
    if (result.schema !== latestSchema(migrationsFolder)) {
      io.out('The backup has an older schema; Dingen migrates it at the next start.')
    }
    io.out('Start Dingen again. Devices that synced after this backup load a fresh copy.')
    return 0
  } catch (err) {
    if (err instanceof RestoreError) {
      io.err(`Not restored: ${err.message}. The database was not changed.`)
      return 1
    }
    throw err
  } finally {
    lock.release()
  }
}

export async function runCli(
  args: string[],
  config: Config = loadConfig(),
  io: CliIo = consoleIo,
): Promise<number> {
  const [command, ...rest] = args
  switch (command) {
    case 'backup':
      return backup(config, io)
    case 'backups':
    case 'list':
      return list(config, io)
    case 'restore':
      return restore(rest[0], config, io)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      io.out(USAGE)
      return command === undefined ? 2 : 0
    default:
      io.err(`Unknown command: ${command}\n\n${USAGE}`)
      return 2
  }
}

// Run when started as a program, not when imported by the tests.
function isMain(): boolean {
  const script = process.argv[1]
  if (!script) return false
  try {
    return fs.realpathSync(script) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) {
  process.exitCode = await runCli(process.argv.slice(2))
}
