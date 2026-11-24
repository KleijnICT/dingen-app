import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type EntityRecord, entitySchemas, type Task } from '@dingen/core'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { listBackups, readJournal } from '../src/backup.js'
import { migrationsFolder } from '../src/db.js'
import { buildExport, parseExport } from '../src/export.js'
import { prepareDatabase } from '../src/startup.js'
import { SyncService } from '../src/sync.js'

/**
 * Plan 33: a database of every release (the alphas and the betas) migrates to the latest schema
 * through the real startup path (backup first, SQL migrations, data
 * migrations) and keeps its data. The databases are SQL dumps in
 * fixtures/alphas, made by that release's own code (see generate.sh and
 * seed.ts there): two accounts, an agent or API token, areas, a project with
 * headings, tasks with checklist items, tags with capitals, a repeating task
 * and its instance, evening and time (before dayparts) or dayparts, a
 * reminder, completed and deleted items, a step-by-step review (the alphas), a calendar,
 * and the change log of all that.
 */

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'alphas')
const ALPHAS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `1.0.0-alpha.${n}`)
const RELEASES = [...ALPHAS, '1.0.0-beta.1']
/** Releases from before dayparts (plan 25): tasks had `evening` and `time`. */
const BEFORE_DAYPARTS = new Set(RELEASES.slice(0, 5))
/** Releases from before agents: an API token, and no actor on changes. */
const BEFORE_AGENTS = new Set(RELEASES.slice(0, 2))

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
})

const silent = { log: () => {}, error: () => {} }

/** The fixture of `version` as a database file, as that release left it. */
function restoreFixture(version: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-alpha-'))
  dirs.push(dir)
  const databasePath = path.join(dir, 'data', 'dingen.db')
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const sqlite = new Database(databasePath)
  sqlite.exec(fs.readFileSync(path.join(FIXTURES, `${version}.sql`), 'utf8'))
  const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n
  const before = {
    migrations: count('select count(*) as n from __drizzle_migrations'),
    entities: count("select count(*) as n from entities where entity_type != 'review'"),
    changes: count("select count(*) as n from changes where entity_type != 'review'"),
    reviews: count("select count(*) as n from entities where entity_type = 'review'"),
  }
  sqlite.close()
  return { dir, databasePath, backupDir: path.join(dir, 'data', 'backups'), before }
}

const parse = (rec: EntityRecord) => entitySchemas[rec.entityType].strict().parse(rec.data)

describe('migrating the database of every alpha release', () => {
  it('has a fixture for every release', () => {
    const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.sql'))
    expect(files.map((f) => f.replace(/\.sql$/, '')).sort()).toEqual([...RELEASES].sort())
  })

  for (const version of RELEASES) {
    it(`${version}: migrates to the latest schema after a backup and keeps the data`, async () => {
      const { databasePath, backupDir, before } = restoreFixture(version)
      // The step-by-step review existed in the alphas only (dropped in 1.0.0-beta.1).
      const reviews = ALPHAS.includes(version) ? 1 : 0
      expect(before.reviews).toBe(reviews)
      const journal = readJournal(migrationsFolder)
      expect(before.migrations).toBeLessThan(journal.length)

      const opened = await prepareDatabase({
        databasePath,
        backupDir,
        migrationsFolder,
        log: silent,
      })
      try {
        const { sqlite, db } = opened
        const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n

        // The backup before migrating: the database as the release left it.
        const backups = listBackups(backupDir)
        expect(backups.map((b) => b.kind)).toEqual(['pre-update'])
        const old = new Database(backups[0]?.file ?? '', { readonly: true })
        try {
          const n = (sql: string) => (old.prepare(sql).get() as { n: number }).n
          expect(n('select count(*) as n from __drizzle_migrations')).toBe(before.migrations)
          expect(n("select count(*) as n from entities where entity_type = 'review'")).toBe(reviews)
        } finally {
          old.close()
        }

        // Every migration ran; the reviews are gone, the rest is there.
        expect(count('select count(*) as n from __drizzle_migrations')).toBe(journal.length)
        expect(count("select count(*) as n from entities where entity_type = 'review'")).toBe(0)
        expect(count("select count(*) as n from changes where entity_type = 'review'")).toBe(0)
        expect(count('select count(*) as n from entities')).toBe(before.entities)
        // The data migrations may add rows to the log (lowercase tags, dayparts), never remove.
        expect(count('select count(*) as n from changes')).toBeGreaterThanOrEqual(before.changes)

        const users = sqlite.prepare('select id, email from users order by email').all() as {
          id: string
          email: string
        }[]
        expect(users.map((u) => u.email)).toEqual(['owner@example.com', 'second@example.com'])
        const [owner, second] = users.map((u) => u.id) as [string, string]
        // The agent (an API token before alpha.3, which the agents migration took over).
        expect(count('select count(*) as n from agents')).toBe(1)
        expect(count('select count(*) as n from api_tokens')).toBe(1)
        const agentTask = sqlite
          .prepare("select actor from changes where fields like '%Book the scaffolding%'")
          .get() as { actor: string | null }
        // Changes have an actor since agents (alpha.3); older rows have none.
        if (BEFORE_AGENTS.has(version)) expect(agentTask.actor).toBeNull()
        else expect(agentTask.actor).toMatch(/^agent:/)

        // A snapshot for each user, every entity valid in today's schema.
        const sync = new SyncService(db)
        const mine = sync.snapshot(owner)
        for (const rec of mine.entities) parse(rec)
        const byTitle = (title: string) => {
          const found = mine.entities.filter((e) => e.data.title === title)
          expect(found, title).toHaveLength(1)
          return found[0] as EntityRecord
        }
        const titles = mine.entities.map((e) => e.data.title as string).sort()
        expect(titles).toEqual(
          [
            'Book the scaffolding',
            'Brush',
            'Buy paint and tape',
            'Call the painter',
            'Finished project',
            'Home',
            'Inbox thought',
            'Learn to sail',
            'Old errand',
            'Paint',
            'Paint the shed',
            'Prepare',
            'Sand the boards',
            'Water the plants',
            'Water the plants',
            'White',
            'Work',
            'errand',
            'phone',
          ].sort(),
        )
        expect(mine.entities.map((e) => e.entityType)).not.toContain('review')
        expect(mine.spaces).toEqual([expect.objectContaining({ kind: 'personal' })])

        // Dayparts: from `evening` and `time` before alpha.6, as they were after.
        const paint = parse(byTitle('Buy paint and tape')) as Task
        expect(paint).toMatchObject({
          daypart: 'evening',
          reminder: { daysBefore: 0, time: '18:30' },
          notes: 'Masking tape too',
          when: { kind: 'date', date: '2026-11-25' },
        })
        expect(paint).not.toHaveProperty('evening')
        const painter = parse(byTitle('Call the painter')) as Task
        expect(painter.daypart).toBe('afternoon')
        if (BEFORE_DAYPARTS.has(version)) {
          expect(painter.reminder).toEqual({ daysBefore: 0, time: '14:30' })
        } else {
          expect(painter.duration).toBe(30)
        }

        // Structure and references.
        const shed = byTitle('Paint the shed')
        const errand = byTitle('errand')
        expect(shed.data.tagIds).toEqual([errand.id])
        expect(paint.tagIds).toEqual([errand.id])
        expect(paint.projectId).toBe(shed.id)
        expect(paint.headingId).toBe(byTitle('Prepare').id)
        const checklist = mine.entities.filter((e) => e.data.taskId === paint.id)
        expect(checklist.map((c) => [c.data.title, c.data.done]).sort()).toEqual([
          ['Brush', true],
          ['White', true],
        ])
        const plants = mine.entities.filter((e) => e.data.title === 'Water the plants')
        const template = plants.find((p) => p.data.repeat !== null)
        expect(template?.data.repeat).toMatchObject({ unit: 'week', every: 1, weekdays: [6] })
        expect(plants.find((p) => p.data.repeat === null)?.data.templateId).toBe(template?.id)
        expect(byTitle('Old errand').data.status).toBe('completed')
        expect(byTitle('Sand the boards').data.status).toBe('completed')
        expect(byTitle('Finished project').data.status).toBe('completed')
        expect(byTitle('Learn to sail').data.when).toEqual({ kind: 'someday' })
        // The deleted task is a tombstone: in the table, not in the snapshot.
        expect(count('select count(*) as n from entities where deleted = 1')).toBe(1)

        // The second account sees only its own.
        const theirs = sync.snapshot(second)
        for (const rec of theirs.entities) parse(rec)
        expect(theirs.entities.map((e) => e.data.title).sort()).toEqual([
          'Garden',
          'Rake the leaves',
        ])

        // Pulling from scratch gives the same as the snapshot, per space.
        const pulled = sync.pullSpaces(owner, {})
        expect(pulled.spaces.flatMap((s) => s.entities ?? []).length).toBe(mine.entities.length)
        expect(pulled.cursor).toEqual(mine.cursor)

        // An export of the migrated data imports again.
        const file = buildExport(db, owner, 'test')
        expect(file.entities).not.toHaveProperty('review')
        const parsed = parseExport(JSON.parse(JSON.stringify(file)))
        expect(parsed.ok && parsed.records.length).toBe(mine.entities.length)

        // The accounts still sign in, and syncing goes on.
        const app = createApp({ db, version: 'test', sqliteVersion: opened.sqliteVersion })
        const login = await app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
        })
        expect(login.status).toBe(200)
        const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
        const snap = await app.request('/api/sync/snapshot', { headers: { cookie } })
        expect(((await snap.json()) as { entities: unknown[] }).entities).toHaveLength(
          mine.entities.length,
        )
      } finally {
        opened.close()
      }

      // A second start finds nothing to do: no new backup.
      const again = await prepareDatabase({
        databasePath,
        backupDir,
        migrationsFolder,
        log: silent,
      })
      again.close()
      expect(listBackups(backupDir)).toHaveLength(1)
    })
  }
})
