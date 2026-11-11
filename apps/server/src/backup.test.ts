import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupBeforeMigrations, pruneBackups } from './backup.js'
import { migrationsFolder, openDatabase } from './db.js'

let dir: string
let migrations: string
let databasePath: string
let backupDir: string
const now = new Date('2026-11-11T09:00:00.000Z')

/** Een kopie van de echte migratiemap, zodat een test er een nep-migratie bij kan zetten. */
function copyMigrations(target: string) {
  fs.cpSync(migrationsFolder, target, { recursive: true })
}

function addFakeMigration(tag: string, sql: string) {
  fs.writeFileSync(path.join(migrations, `${tag}.sql`), sql)
  const file = path.join(migrations, 'meta/_journal.json')
  const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[]
  }
  const last = journal.entries[journal.entries.length - 1]
  journal.entries.push({
    idx: (last?.idx ?? -1) + 1,
    version: '6',
    when: (last?.when ?? 0) + 1000,
    tag,
    breakpoints: true,
  })
  fs.writeFileSync(file, JSON.stringify(journal))
}

function lastTag(): string {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] }
  return journal.entries[journal.entries.length - 1]?.tag.split('_')[0] ?? ''
}

const options = () => ({ databasePath, backupDir, migrationsFolder: migrations, now })

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-backup-'))
  migrations = path.join(dir, 'drizzle')
  databasePath = path.join(dir, 'data', 'dingen.db')
  backupDir = path.join(dir, 'data', 'backups')
  copyMigrations(migrations)
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('back-up vóór migraties', () => {
  it('doet niets bij een nieuwe installatie', async () => {
    expect(await backupBeforeMigrations(options())).toBeNull()
    expect(fs.existsSync(backupDir)).toBe(false)
  })

  it('doet niets bij een lege database', async () => {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    new Database(databasePath).close()
    expect(await backupBeforeMigrations(options())).toBeNull()
  })

  it('doet niets als er geen migraties klaarstaan', async () => {
    openDatabase(databasePath, { migrationsFolder: migrations }).close()
    expect(await backupBeforeMigrations(options())).toBeNull()
    expect(fs.existsSync(backupDir)).toBe(false)
  })

  it('kopieert de database vóór een nieuwe migratie, met de inhoud van vóór de migratie', async () => {
    const before = openDatabase(databasePath, { migrationsFolder: migrations })
    before.sqlite
      .prepare('insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)')
      .run('U1', 'proef@example.com', 'x', now.toISOString())
    before.close()

    addFakeMigration('9001_proef', 'CREATE TABLE `proef` (`id` text PRIMARY KEY NOT NULL);')
    addFakeMigration('9002_proef', 'ALTER TABLE `proef` ADD `naam` text;')

    const result = await backupBeforeMigrations(options())
    const from = lastTag()
    expect(result).toEqual({
      file: path.join(backupDir, `dingen-2026-11-11-${from}-9002.db`),
      from,
      to: '9002',
      pending: ['9001_proef', '9002_proef'],
    })

    const copy = new Database(result?.file ?? '', { readonly: true })
    expect(copy.prepare('select email from users').all()).toEqual([{ email: 'proef@example.com' }])
    expect(
      copy.prepare("select name from sqlite_master where type = 'table' and name = 'proef'").all(),
    ).toEqual([])
    copy.close()

    // Daarna migreert openDatabase gewoon, en is er niets meer te kopiëren.
    const after = openDatabase(databasePath, { migrationsFolder: migrations })
    expect(after.sqlite.prepare('select count(*) as n from proef').get()).toEqual({ n: 0 })
    after.close()
    expect(await backupBeforeMigrations(options())).toBeNull()
  })

  it('kiest een vrije naam als er vandaag al een kopie is', async () => {
    openDatabase(databasePath, { migrationsFolder: migrations }).close()
    addFakeMigration('9001_proef', 'CREATE TABLE `proef` (`id` text);')
    const first = await backupBeforeMigrations(options())
    const second = await backupBeforeMigrations(options())
    expect(second?.file).toBe(first?.file.replace(/\.db$/, '-2.db'))
  })

  it('bewaart de tien nieuwste kopieën', async () => {
    openDatabase(databasePath, { migrationsFolder: migrations }).close()
    fs.mkdirSync(backupDir, { recursive: true })
    for (let i = 0; i < 12; i++) {
      const file = path.join(
        backupDir,
        `dingen-2026-01-${String(i + 1).padStart(2, '0')}-0001-0002.db`,
      )
      fs.writeFileSync(file, 'oud')
      const t = new Date(2026, 0, i + 1)
      fs.utimesSync(file, t, t)
    }
    fs.writeFileSync(path.join(backupDir, 'iets-anders.txt'), 'blijft')
    addFakeMigration('9001_proef', 'CREATE TABLE `proef` (`id` text);')
    const result = await backupBeforeMigrations(options())

    const left = fs.readdirSync(backupDir).sort()
    expect(left).toHaveLength(11)
    expect(left).toContain('iets-anders.txt')
    expect(left).toContain(path.basename(result?.file ?? ''))
    // De drie oudste zijn weg.
    for (const day of ['01', '02', '03']) {
      expect(left).not.toContain(`dingen-2026-01-${day}-0001-0002.db`)
    }
  })

  it('faalt als de kopie niet kan worden geschreven', async () => {
    openDatabase(databasePath, { migrationsFolder: migrations }).close()
    addFakeMigration('9001_proef', 'CREATE TABLE `proef` (`id` text);')
    // Een bestand op de plek van de map: de kopie kan er niet komen.
    fs.writeFileSync(backupDir, 'geen map')
    await expect(backupBeforeMigrations(options())).rejects.toThrow()
  })
})

describe('pruneBackups', () => {
  it('laat niets weg als er minder zijn dan het maximum', () => {
    fs.mkdirSync(backupDir, { recursive: true })
    fs.writeFileSync(path.join(backupDir, 'dingen-a.db'), '')
    expect(pruneBackups(backupDir, 10)).toEqual([])
  })
})
