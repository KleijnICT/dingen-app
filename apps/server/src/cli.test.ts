import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listBackups, writeBackup } from './backup.js'
import { BackupScheduler, localDayHour } from './backup-scheduler.js'
import { runCli } from './cli.js'
import { type Config, loadConfig } from './config.js'
import { migrationsFolder, openDatabase } from './db.js'
import { DataDirLock } from './lock.js'

let dir: string
let config: Config
let out: string[]
let err: string[]
const io = {
  out: (line: string) => out.push(line),
  err: (line: string) => err.push(line),
}

function setEmail(email: string) {
  const db = new Database(config.databasePath)
  db.prepare('update users set email = ?').run(email)
  db.close()
}

function email(): string {
  const db = new Database(config.databasePath, { readonly: true })
  try {
    return (db.prepare('select email from users').get() as { email: string }).email
  } finally {
    db.close()
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-cli-'))
  config = loadConfig({ DATA_DIR: dir }, { optionsPath: path.join(dir, 'geen-options.json') })
  out = []
  err = []
  const db = openDatabase(config.databasePath)
  db.sqlite
    .prepare(
      "insert into users (id, email, password_hash, created_at) values ('U1', 'eerst@example.com', 'x', '2026-01-01')",
    )
    .run()
  db.close()
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('dingen (command line)', () => {
  it('backup en backups', async () => {
    expect(await runCli(['backup'], config, io)).toBe(0)
    const [made] = listBackups(config.backupDir)
    expect(made?.kind).toBe('manual')
    expect(out.join('\n')).toContain(made?.file)
    out = []
    expect(await runCli(['backups'], config, io)).toBe(0)
    expect(out[0]).toMatch(/^File\s+Kind\s+Date \(Europe\/Amsterdam\)\s+Schema\s+Size$/)
    expect(out[1]).toContain(made?.name)
    expect(out[1]).toContain('manual')
    expect(out.join('\n')).toContain('1 backup(s)')
  })

  it('backup werkt terwijl de server draait (lock en open verbinding)', async () => {
    const lock = DataDirLock.acquire(config.dataDir)
    const live = openDatabase(config.databasePath)
    live.sqlite.prepare("update users set email = 'live@example.com'").run()
    try {
      expect(await runCli(['backup'], config, io)).toBe(0)
    } finally {
      live.close()
      lock?.release()
    }
    const [made] = listBackups(config.backupDir)
    const copy = new Database(made?.file ?? '', { readonly: true })
    expect(copy.prepare('select email from users').get()).toEqual({ email: 'live@example.com' })
    copy.close()
  })

  it('restore zet terug, na een back-up van de huidige stand', async () => {
    await runCli(['backup'], config, io)
    const [made] = listBackups(config.backupDir)
    setEmail('later@example.com')
    expect(await runCli(['restore', made?.name ?? ''], config, io)).toBe(0)
    expect(email()).toBe('eerst@example.com')
    const saved = listBackups(config.backupDir).find((b) => b.kind === 'pre-restore')
    expect(saved).toBeDefined()
    const copy = new Database(saved?.file ?? '', { readonly: true })
    expect(copy.prepare('select email from users').get()).toEqual({ email: 'later@example.com' })
    copy.close()
    expect(out.join('\n')).toContain('Start Dingen again')
  })

  it('restore weigert terwijl de server draait', async () => {
    await runCli(['backup'], config, io)
    const [made] = listBackups(config.backupDir)
    setEmail('later@example.com')
    const lock = DataDirLock.acquire(config.dataDir)
    try {
      expect(await runCli(['restore', made?.file ?? ''], config, io)).toBe(1)
    } finally {
      lock?.release()
    }
    expect(err.join('\n')).toContain('Dingen is running')
    expect(email()).toBe('later@example.com')
    expect(listBackups(config.backupDir)).toHaveLength(1)
  })

  it('restore weigert een bestand dat geen Dingen-database is', async () => {
    const junk = path.join(dir, 'junk.db')
    fs.writeFileSync(junk, 'geen database')
    expect(await runCli(['restore', junk], config, io)).toBe(1)
    expect(err.join('\n')).toMatch(/Not restored: .*The database was not changed/)
    expect(email()).toBe('eerst@example.com')
  })

  it('restore zonder of met een onbekend bestand, en onbekende opdrachten', async () => {
    expect(await runCli(['restore'], config, io)).toBe(2)
    expect(await runCli(['restore', 'bestaat-niet.db'], config, io)).toBe(1)
    expect(await runCli(['iets'], config, io)).toBe(2)
    expect(await runCli(['help'], config, io)).toBe(0)
    expect(out.join('\n')).toContain('Usage: dingen')
  })
})

describe('BackupScheduler', () => {
  it('maakt elke dag één back-up, vanaf 03:00 in de tijdzone', async () => {
    const db = openDatabase(config.databasePath)
    let now = Date.parse('2026-11-13T00:30:00Z') // 01:30 in Amsterdam
    const scheduler = new BackupScheduler(db.sqlite, {
      backupDir: config.backupDir,
      migrationsFolder,
      timezone: 'Europe/Amsterdam',
      now: () => now,
    })
    try {
      expect(await scheduler.tick()).toBeNull()
      now = Date.parse('2026-11-13T02:05:00Z') // 03:05
      const file = await scheduler.tick()
      expect(path.basename(file ?? '')).toMatch(/^dingen-daily-2026-11-13T020500Z-\d{4}\.db$/)
      now = Date.parse('2026-11-13T20:00:00Z')
      expect(await scheduler.tick()).toBeNull()
      // 23:30 UTC is already the 14th in Amsterdam, but before 03:00.
      now = Date.parse('2026-11-13T23:30:00Z')
      expect(await scheduler.tick()).toBeNull()
      // Server was off at 03:00: the back-up follows at the first look.
      now = Date.parse('2026-11-14T09:00:00Z')
      expect(await scheduler.tick()).not.toBeNull()
      expect(listBackups(config.backupDir).map((b) => b.kind)).toEqual(['daily', 'daily'])
    } finally {
      db.close()
    }
  })

  it('telt een back-up van een ander soort niet mee', async () => {
    const db = openDatabase(config.databasePath)
    const now = Date.parse('2026-11-13T05:00:00Z')
    await writeBackup(db.sqlite, {
      backupDir: config.backupDir,
      kind: 'manual',
      schema: '0008',
      now: new Date(now),
    })
    const scheduler = new BackupScheduler(db.sqlite, {
      backupDir: config.backupDir,
      migrationsFolder,
      timezone: 'Europe/Amsterdam',
      now: () => now,
    })
    expect(scheduler.due()).toBe(true)
    db.close()
  })

  it('localDayHour', () => {
    expect(localDayHour(Date.parse('2026-11-13T23:30:00Z'), 'Europe/Amsterdam')).toEqual({
      day: '2026-11-14',
      hour: 0,
    })
    expect(localDayHour(Date.parse('2026-07-01T01:00:00Z'), 'Europe/Amsterdam')).toEqual({
      day: '2026-07-01',
      hour: 3,
    })
  })
})

describe('config', () => {
  it('DINGEN_BACKUPS', () => {
    const opts = { optionsPath: path.join(dir, 'geen-options.json') }
    expect(loadConfig({}, opts).backups).toBe(true)
    expect(loadConfig({ DINGEN_BACKUPS: 'off' }, opts).backups).toBe(false)
    expect(loadConfig({ DINGEN_BACKUPS: 'OFF' }, opts).backups).toBe(false)
    expect(loadConfig({ DINGEN_BACKUPS: 'on' }, opts).backups).toBe(true)
    expect(loadConfig({ DATA_DIR: '/x' }, opts).backupDir).toBe(path.join('/x', 'backups'))
  })
})
