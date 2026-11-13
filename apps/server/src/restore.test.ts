import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type Change,
  CursorAheadError,
  createClock,
  newTask,
  type SpaceCursor,
  ulid,
} from '@dingen/core'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { writeBackup } from './backup.js'
import { migrationsFolder, type OpenedDatabase, openDatabase } from './db.js'
import { DataDirLock } from './lock.js'
import { CURSOR_GAPS_KEY, RestoreError, readGaps, replaceDatabase } from './restore.js'
import { spaceMembers, spaces } from './schema.js'
import { createPersonalSpace } from './spaces/service.js'
import { SyncService } from './sync.js'

let dir: string
let databasePath: string
let backupDir: string
let db: OpenedDatabase
let personal: string
const clock = createClock('TEST')

function open(): OpenedDatabase {
  db = openDatabase(databasePath)
  return db
}

function taskChange(title: string, spaceId?: string): Change {
  const { id, ...fields } = newTask({ title })
  return {
    id: ulid(),
    entityType: 'task',
    entityId: id,
    fields: spaceId ? { ...fields, spaceId } : fields,
    ts: clock.now(),
    clientId: 'TEST',
  }
}

function titles(sync: SyncService): string[] {
  return sync
    .snapshot('U1')
    .entities.map((e) => String(e.data.title))
    .sort()
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-restore-'))
  databasePath = path.join(dir, 'dingen.db')
  backupDir = path.join(dir, 'backups')
  open()
  db.sqlite
    .prepare(
      "insert into users (id, email, password_hash, created_at) values ('U1', 'u1@example.com', 'x', '2026-01-01')",
    )
    .run()
  personal = createPersonalSpace(db.db, 'U1', '2026-01-01')
})

afterEach(() => {
  if (db.sqlite.open) db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * A back-up after two tasks, then two more tasks that a client saw; then the
 * back-up is restored. Returns the client's cursor from before the restore.
 */
async function restoreWithLostChanges(): Promise<{ backup: string; cursor: SpaceCursor }> {
  const sync = new SyncService(db.db)
  sync.push('U1', [taskChange('Een'), taskChange('Twee')])
  const backup = await writeBackup(db.sqlite, { backupDir, kind: 'manual', schema: 'x' })
  sync.push('U1', [taskChange('Drie'), taskChange('Vier')])
  const { cursor } = sync.snapshot('U1')
  db.close()
  replaceDatabase(databasePath, backup, { check: { migrationsFolder } })
  open()
  return { backup, cursor }
}

describe('replaceDatabase', () => {
  it('zet een back-up terug en noteert de verloren seq-reeks', async () => {
    const { cursor } = await restoreWithLostChanges()
    const sync = new SyncService(db.db)
    expect(titles(sync)).toEqual(['Een', 'Twee'])
    const seq = cursor[personal] ?? 0
    expect(readGaps(db.sqlite)).toEqual([{ after: seq - 2, upTo: seq }])
    // New changes are numbered after what the replaced database handed out.
    sync.push('U1', [taskChange('Vijf')])
    const max = db.sqlite.prepare('select max(seq) as seq from changes').get() as { seq: number }
    expect(max.seq).toBe(seq + 1)
    expect(fs.existsSync(`${databasePath}.restoring`)).toBe(false)
  })

  it('noteert niets als er niets verloren ging', async () => {
    const sync = new SyncService(db.db)
    sync.push('U1', [taskChange('Een')])
    const backup = await writeBackup(db.sqlite, { backupDir, kind: 'manual', schema: 'x' })
    db.close()
    expect(replaceDatabase(databasePath, backup).gap).toBeNull()
    open()
    expect(readGaps(db.sqlite)).toEqual([])
  })

  it('weigert een bestand dat geen Dingen-database is en laat de database staan', () => {
    db.close()
    const junk = path.join(dir, 'junk.db')
    fs.writeFileSync(junk, 'dit is geen database, maar wel lang genoeg om op een header te lijken')
    expect(() => replaceDatabase(databasePath, junk, { check: { migrationsFolder } })).toThrow(
      /not an SQLite database|not a database/,
    )
    const other = path.join(dir, 'other.db')
    const o = new Database(other)
    o.exec('create table iets (id text)')
    o.close()
    expect(() => replaceDatabase(databasePath, other, { check: { migrationsFolder } })).toThrow(
      /not a Dingen database/,
    )
    open()
    expect(db.sqlite.prepare('select email from users').all()).toEqual([
      { email: 'u1@example.com' },
    ])
    expect(fs.existsSync(`${databasePath}.restoring`)).toBe(false)
  })

  it('weigert een back-up van een nieuwere versie', async () => {
    const backup = await writeBackup(db.sqlite, { backupDir, kind: 'manual', schema: 'x' })
    const b = new Database(backup)
    b.prepare("insert into __drizzle_migrations (hash, created_at) values ('nieuw', ?)").run(
      Date.now() + 10 ** 12,
    )
    b.close()
    db.close()
    const error = (() => {
      try {
        replaceDatabase(databasePath, backup, { check: { migrationsFolder } })
      } catch (err) {
        return err
      }
    })()
    expect(error).toBeInstanceOf(RestoreError)
    expect((error as Error).message).toContain('newer version')
  })
})

describe('sync na terugzetten', () => {
  it('protocol 2: een cursor voorbij het log krijgt de ruimte opnieuw, gemarkeerd resync', async () => {
    const { cursor } = await restoreWithLostChanges()
    const sync = new SyncService(db.db)
    const pulled = sync.pullSpaces('U1', cursor)
    const space = pulled.spaces[0]
    expect(space?.resync).toBe(true)
    expect(space?.entities?.map((e) => e.data.title).sort()).toEqual(['Een', 'Twee'])
    // The new cursor is the server's: the next pull is normal.
    const again = sync.pullSpaces('U1', pulled.cursor)
    expect(again.spaces[0]?.resync).toBeUndefined()
    expect(again.spaces[0]?.entities).toBeUndefined()
  })

  it('protocol 2: ook na nieuwe wijzigingen blijft een oude cursor herkend', async () => {
    const { cursor } = await restoreWithLostChanges()
    const sync = new SyncService(db.db)
    sync.push('U1', [taskChange('Vijf'), taskChange('Zes'), taskChange('Zeven')])
    const space = sync.pullSpaces('U1', cursor).spaces[0]
    expect(space?.resync).toBe(true)
    expect(space?.entities).toHaveLength(5)
    // A push with that cursor does not move it past the lost range.
    const pushed = sync.push('U1', [taskChange('Acht')], { cursor })
    expect(pushed.cursor).toEqual({})
  })

  it('protocol 2: een cursor voorbij het log zonder notitie (met de hand teruggezet)', () => {
    const sync = new SyncService(db.db)
    sync.push('U1', [taskChange('Een')])
    const { cursor } = sync.snapshot('U1')
    const ahead = { [personal]: (cursor[personal] ?? 0) + 5 }
    expect(sync.pullSpaces('U1', ahead).spaces[0]?.resync).toBe(true)
    expect(sync.pullSpaces('U1', cursor).spaces[0]?.resync).toBeUndefined()
    // A numeric (protocol 1) cursor ahead: every space again.
    expect(sync.pullSpaces('U1', (cursor[personal] ?? 0) + 5).spaces[0]?.resync).toBe(true)
  })

  it('een getal als cursor wordt per ruimte de hoogste seq van die ruimte, zonder resync', () => {
    db.db
      .insert(spaces)
      .values({ id: 'S2', kind: 'shared', ownerId: 'U1', createdAt: '2026-01-01' })
      .run()
    db.db
      .insert(spaceMembers)
      .values({ spaceId: 'S2', userId: 'U1', level: 'manage', joinedAt: '2026-01-01' })
      .run()
    const sync = new SyncService(db.db)
    sync.push('U1', [taskChange('Gedeeld', 'S2')])
    sync.push('U1', [taskChange('Eigen')])
    const { cursor, seq } = sync.snapshot('U1')
    const pulled = sync.pullSpaces('U1', seq)
    expect(pulled.spaces.map((s) => s.resync)).toEqual([undefined, undefined])
    expect(pulled.cursor).toEqual(cursor)
    // That cursor is valid from then on.
    expect(sync.pullSpaces('U1', pulled.cursor).spaces.some((s) => s.resync)).toBe(false)
  })

  it('protocol 1: een cursor voorbij het log geeft CursorAheadError en via HTTP 409', async () => {
    const { cursor } = await restoreWithLostChanges()
    const sync = new SyncService(db.db)
    const since = cursor[personal] ?? 0
    expect(() => sync.pull('U1', since)).toThrow(CursorAheadError)
    expect(sync.pull('U1', 0).changes).toHaveLength(2)

    const app = createApp({
      db: db.db,
      version: 'test',
      sqliteVersion: 'x',
      registrationOpen: true,
    })
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'http@example.com', password: 'wachtwoord123' }),
    })
    const cookie = res.headers.get('set-cookie') ?? ''
    const pull = await app.request(`/api/sync/pull?since=${since + 100}`, { headers: { cookie } })
    expect(pull.status).toBe(409)
    expect(await pull.json()).toMatchObject({ error: 'cursor_ahead', resync: true })
    const p2 = await app.request(`/api/sync/pull?cursor=${encodeURIComponent('{}')}`, {
      headers: { cookie },
    })
    expect(p2.status).toBe(200)
  })

  it('bewaart de notities van de vervangen database bij een volgende terugzet', async () => {
    const { backup } = await restoreWithLostChanges()
    const first = readGaps(db.sqlite)
    const sync = new SyncService(db.db)
    sync.push('U1', [taskChange('Vijf')])
    db.close()
    replaceDatabase(databasePath, backup)
    open()
    const gaps = readGaps(db.sqlite)
    expect(gaps).toHaveLength(2)
    expect(gaps).toEqual(expect.arrayContaining(first))
    expect(
      db.sqlite.prepare('select key from meta where key = ?').get(CURSOR_GAPS_KEY),
    ).toBeTruthy()
  })
})

describe('DataDirLock', () => {
  it('één houder tegelijk; vrij na loslaten', () => {
    const lock = DataDirLock.acquire(dir)
    expect(lock).not.toBeNull()
    expect(DataDirLock.acquire(dir)).toBeNull()
    lock?.release()
    const again = DataDirLock.acquire(dir)
    expect(again).not.toBeNull()
    again?.release()
  })
})
