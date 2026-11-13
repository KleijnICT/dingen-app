import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type BackupEntry,
  backupBeforeMigrations,
  isoWeek,
  listBackups,
  parseBackupName,
  planRetention,
  pruneBackups,
  writeBackup,
} from './backup.js'
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
      file: path.join(backupDir, `dingen-pre-update-2026-11-11T090000Z-${from}.db`),
      from,
      to: '9002',
      pending: ['9001_proef', '9002_proef'],
    })

    const copy = new Database(result?.file ?? '', { readonly: true })
    expect(copy.prepare('select email from users').all()).toEqual([{ email: 'proef@example.com' }])
    // One self-contained file: no write-ahead log.
    expect(copy.pragma('journal_mode', { simple: true })).toBe('delete')
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

  it('maakt ook een kopie als alleen `alsoWhen` iets te doen heeft (datamigraties)', async () => {
    openDatabase(databasePath, { migrationsFolder: migrations }).close()
    expect(await backupBeforeMigrations({ ...options(), alsoWhen: () => false })).toBeNull()
    const result = await backupBeforeMigrations({ ...options(), alsoWhen: () => true })
    expect(result).toMatchObject({ from: lastTag(), to: lastTag(), pending: [] })
    expect(fs.existsSync(result?.file ?? '')).toBe(true)
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
    expect(left.filter((f) => f.endsWith('.partial'))).toEqual([])
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
  it('laat andere bestanden staan', () => {
    fs.mkdirSync(backupDir, { recursive: true })
    fs.writeFileSync(path.join(backupDir, 'dingen-a.db'), '')
    expect(pruneBackups(backupDir)).toEqual([])
    expect(fs.readdirSync(backupDir)).toEqual(['dingen-a.db'])
  })

  it('ruimt dagelijkse kopieën op volgens de regels, handmatige nooit', () => {
    fs.mkdirSync(backupDir, { recursive: true })
    for (let d = 1; d <= 20; d++) {
      const day = String(d).padStart(2, '0')
      fs.writeFileSync(path.join(backupDir, `dingen-daily-2026-11-${day}T020000Z-0008.db`), '')
    }
    fs.writeFileSync(path.join(backupDir, 'dingen-manual-2025-01-01T120000Z-0001.db'), '')
    const removed = pruneBackups(backupDir).map((f) => path.basename(f))
    const left = fs.readdirSync(backupDir).sort()
    expect(left).toContain('dingen-manual-2025-01-01T120000Z-0001.db')
    // 7 newest (14–20), the newest of the weeks before (W45: 8th, W44: 1st), the month is the 20th.
    expect(left.filter((f) => f.includes('daily')).map((f) => f.slice(21, 23))).toEqual([
      '01',
      '08',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
      '20',
    ])
    expect(removed).toHaveLength(11)
  })
})

describe('back-upnamen', () => {
  it('leest soort, moment en schema uit de naam', () => {
    expect(parseBackupName('dingen-daily-2026-11-13T030512Z-0008.db')).toEqual({
      kind: 'daily',
      at: new Date('2026-11-13T03:05:12Z'),
      schema: '0008',
    })
    expect(parseBackupName('dingen-pre-update-2026-11-13T030512Z-0007-2.db')?.kind).toBe(
      'pre-update',
    )
    expect(parseBackupName('dingen-manual-2026-11-13T030512Z-0008.db')?.kind).toBe('manual')
    // Names from before plan 24 count as pre-update, with the file's time.
    expect(parseBackupName('dingen-2026-11-11-0006-0008.db')).toEqual({
      kind: 'pre-update',
      at: null,
      schema: '0006',
    })
    expect(parseBackupName('dingen-daily-2026-11-13T030512Z-0008.db.partial')).toBeNull()
    expect(parseBackupName('dingen.db')).toBeNull()
  })

  it('writeBackup schrijft een consistente kopie met soort, tijd en schema in de naam', async () => {
    const db = openDatabase(databasePath, { migrationsFolder: migrations })
    db.sqlite
      .prepare('insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)')
      .run('U1', 'live@example.com', 'x', now.toISOString())
    // While the connection is open and the data is still in the write-ahead log.
    const file = await writeBackup(db.sqlite, {
      backupDir,
      kind: 'manual',
      schema: '0008',
      now,
    })
    db.close()
    expect(path.basename(file)).toBe('dingen-manual-2026-11-11T090000Z-0008.db')
    const copy = new Database(file, { readonly: true })
    expect(copy.prepare('select email from users').all()).toEqual([{ email: 'live@example.com' }])
    copy.close()
    expect(listBackups(backupDir)).toMatchObject([{ kind: 'manual', schema: '0008' }])
  })
})

describe('planRetention', () => {
  const entry = (kind: BackupEntry['kind'], iso: string): BackupEntry => ({
    name: `${kind}-${iso}`,
    kind,
    at: new Date(iso),
  })

  it('ISO-weken', () => {
    expect(isoWeek(new Date('2026-11-13T02:00:00Z'))).toBe('2026-W46')
    expect(isoWeek(new Date('2027-01-01T02:00:00Z'))).toBe('2026-W53')
    expect(isoWeek(new Date('2026-01-01T02:00:00Z'))).toBe('2026-W01')
  })

  it('houdt 7 dagelijkse, 4 wekelijkse en 3 maandelijkse', () => {
    // Every day from 1 July to 13 November 2026.
    const entries: BackupEntry[] = []
    for (let t = Date.UTC(2026, 6, 1, 2); t <= Date.UTC(2026, 10, 13, 2); t += 86_400_000) {
      entries.push(entry('daily', new Date(t).toISOString()))
    }
    const { keep, remove } = planRetention(entries)
    const days = keep.map((n) => n.slice(6, 16)).sort()
    expect(days).toEqual([
      // Monthly: the newest of September and October (November's is the 13th).
      '2026-09-30',
      // Weekly: the Sundays ending W43, W44 and W45 (W46 is in the 7 newest).
      '2026-10-25',
      '2026-10-31',
      '2026-11-01',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ])
    expect(keep.length + remove.length).toBe(entries.length)
  })

  it('houdt de 10 nieuwste van vóór een update en vóór terugzetten, en alle handmatige', () => {
    const entries: BackupEntry[] = []
    for (let d = 1; d <= 12; d++) {
      const day = String(d).padStart(2, '0')
      entries.push(entry('pre-update', `2026-10-${day}T10:00:00.000Z`))
      entries.push(entry('pre-restore', `2026-10-${day}T11:00:00.000Z`))
      entries.push(entry('manual', `2020-10-${day}T12:00:00.000Z`))
    }
    const { remove } = planRetention(entries)
    expect(remove.sort()).toEqual([
      'pre-restore-2026-10-01T11:00:00.000Z',
      'pre-restore-2026-10-02T11:00:00.000Z',
      'pre-update-2026-10-01T10:00:00.000Z',
      'pre-update-2026-10-02T10:00:00.000Z',
    ])
  })

  it('houdt alles zolang er weinig zijn', () => {
    const entries = [
      entry('daily', '2026-11-12T02:00:00.000Z'),
      entry('daily', '2025-01-01T02:00:00.000Z'),
    ]
    expect(planRetention(entries).remove).toEqual([])
  })
})
