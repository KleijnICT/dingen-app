import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listBackups } from './backup.js'
import { migrationsFolder, openDatabase } from './db.js'
import { type DataMigration, prepareDatabase, StartupError } from './startup.js'
import { LOWERCASE_TAGS_KEY } from './tags/lowercase.js'

let dir: string
let migrations: string
let databasePath: string
let backupDir: string
const lines: string[] = []
const log = { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) }

function addMigration(tag: string, sql: string) {
  fs.writeFileSync(path.join(migrations, `${tag}.sql`), sql)
  const file = path.join(migrations, 'meta/_journal.json')
  const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[]
  }
  const last = journal.entries.at(-1)
  journal.entries.push({
    idx: (last?.idx ?? -1) + 1,
    version: '6',
    when: (last?.when ?? 0) + 1000,
    tag,
    breakpoints: true,
  })
  fs.writeFileSync(file, JSON.stringify(journal))
}

/** An existing database with one user, all migrations and data migrations done. */
async function existingDatabase() {
  const db = await prepareDatabase({ databasePath, backupDir, migrationsFolder: migrations, log })
  db.sqlite
    .prepare('insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)')
    .run('U1', 'blijft@example.com', 'x', '2026-11-01T00:00:00.000Z')
  db.close()
}

function emails(): string[] {
  const db = new Database(databasePath, { readonly: true })
  try {
    return (db.prepare('select email from users').all() as { email: string }[]).map((r) => r.email)
  } finally {
    db.close()
  }
}

const options = (extra: { dataMigrations?: DataMigration[] } = {}) => ({
  databasePath,
  backupDir,
  migrationsFolder: migrations,
  log,
  ...extra,
})

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-startup-'))
  migrations = path.join(dir, 'drizzle')
  databasePath = path.join(dir, 'data', 'dingen.db')
  backupDir = path.join(dir, 'data', 'backups')
  fs.cpSync(migrationsFolder, migrations, { recursive: true })
  lines.length = 0
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('prepareDatabase', () => {
  it('maakt een nieuwe database zonder back-up en voert de datamigraties uit', async () => {
    const db = await prepareDatabase(options())
    expect(
      db.sqlite.prepare('select 1 from meta where key = ?').get(LOWERCASE_TAGS_KEY),
    ).toBeTruthy()
    db.close()
    expect(listBackups(backupDir)).toEqual([])
  })

  it('maakt geen back-up als er niets te migreren is', async () => {
    await existingDatabase()
    ;(await prepareDatabase(options())).close()
    expect(listBackups(backupDir)).toEqual([])
  })

  it('zet de back-up terug als een SQL-migratie faalt, en stopt', async () => {
    await existingDatabase()
    addMigration(
      '9001_kapot',
      'CREATE TABLE `proef` (`id` text);\n--> statement-breakpoint\nTHIS IS NOT SQL;',
    )

    const error = await prepareDatabase(options()).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(StartupError)
    const message = (error as Error).message
    const [backup] = listBackups(backupDir)
    expect(backup?.kind).toBe('pre-update')
    expect(message).toContain('9001_kapot')
    expect(message).toContain(`restored to ${backup?.file}`)
    expect(message).toContain('Start the previous version')

    // The database is the one from before: the data is there, the new table is not.
    expect(emails()).toEqual(['blijft@example.com'])
    const db = new Database(databasePath, { readonly: true })
    expect(db.prepare("select name from sqlite_master where name = 'proef'").all()).toEqual([])
    db.close()
    expect(fs.existsSync(`${databasePath}-wal`)).toBe(false)
    expect(fs.existsSync(`${databasePath}.restoring`)).toBe(false)
  })

  it('zet de back-up terug als een datamigratie faalt, ook na half werk', async () => {
    await existingDatabase()
    const broken: DataMigration = {
      key: 'data_migration.proef',
      name: 'proef',
      run: (db) => {
        db.$client.prepare("update users set email = 'half@example.com' where id = 'U1'").run()
        throw new Error('kapot')
      },
    }
    const error = await prepareDatabase(options({ dataMigrations: [broken] })).catch(
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(StartupError)
    expect((error as Error).message).toContain('Data migration "proef" failed: kapot')
    // A back-up was made because the data migration had not run yet.
    expect(lines.some((l) => l.startsWith('Data migration pending: backup written to'))).toBe(true)
    expect(emails()).toEqual(['blijft@example.com'])
    expect(fs.existsSync(`${databasePath}-wal`)).toBe(false)
    expect(fs.existsSync(`${databasePath}-shm`)).toBe(false)
  })

  it('verwijdert een achtergebleven -wal en -shm bij het terugzetten', async () => {
    await existingDatabase()
    let other: Database.Database | undefined
    const broken: DataMigration = {
      key: 'data_migration.proef',
      name: 'proef',
      run: () => {
        // A second connection that stays open keeps the write-ahead log alive.
        other = new Database(databasePath)
        other.prepare("update users set email = 'wal@example.com'").run()
        expect(fs.existsSync(`${databasePath}-wal`)).toBe(true)
        throw new Error('kapot')
      },
    }
    await expect(prepareDatabase(options({ dataMigrations: [broken] }))).rejects.toThrow(
      StartupError,
    )
    expect(fs.existsSync(`${databasePath}-wal`)).toBe(false)
    expect(emails()).toEqual(['blijft@example.com'])
    other?.close()
  })

  it('draait een gelukte datamigratie één keer, na een back-up', async () => {
    await existingDatabase()
    let runs = 0
    const ok: DataMigration = {
      key: 'data_migration.proef',
      name: 'proef',
      run: (db) => {
        runs += 1
        db.$client
          .prepare("insert into meta (key, value) values ('data_migration.proef', 'done')")
          .run()
        return 'proef gedaan'
      },
    }
    ;(await prepareDatabase(options({ dataMigrations: [ok] }))).close()
    ;(await prepareDatabase(options({ dataMigrations: [ok] }))).close()
    expect(runs).toBe(1)
    expect(lines).toContain('proef gedaan')
    expect(listBackups(backupDir)).toHaveLength(1)
  })

  it('stopt zonder terugzetten als een nieuwe database faalt', async () => {
    const broken: DataMigration = {
      key: 'data_migration.proef',
      name: 'proef',
      run: () => {
        throw new Error('kapot')
      },
    }
    const error = await prepareDatabase(options({ dataMigrations: [broken] })).catch(
      (err: unknown) => err,
    )
    expect((error as Error).message).toContain('no backup to go back to')
  })

  it('start niet als de back-up niet kan worden geschreven', async () => {
    await existingDatabase()
    addMigration('9001_proef', 'CREATE TABLE `proef` (`id` text);')
    fs.writeFileSync(backupDir, 'geen map')
    const error = await prepareDatabase(options()).catch((err: unknown) => err)
    expect((error as Error).message).toContain('Could not back up the database')
    expect(emails()).toEqual(['blijft@example.com'])
  })
})

describe('openDatabase', () => {
  it('sluit de verbinding als een migratie faalt', () => {
    addMigration('9001_kapot', 'THIS IS NOT SQL;')
    expect(() => openDatabase(databasePath, { migrationsFolder: migrations })).toThrow()
    // Closed: the file can be removed and replaced without a lingering write-ahead log.
    expect(fs.existsSync(`${databasePath}-wal`)).toBe(false)
  })
})
