import type Database from 'better-sqlite3'
import { BACKUP_HOUR, BACKUP_TICK_MS, localDayHour } from './backup-scheduler.js'

/**
 * Pruning the change log (`changes`) after one year. Fixed, not configurable.
 *
 * What is safe to delete: the current state of every entity lives in
 * `entities` (the data, the per-field timestamps for last-writer-wins, the
 * `deleted` tombstone), and push, pull snapshots, export and restore read it
 * from there, never by replaying the log. The log is only needed for deltas
 * (a client pulling what came after its cursor) and for the Logbook
 * (activity), which loses lines older than a year with it.
 *
 * What is kept: the newest row of every space, whatever its age. The highest
 * `seq` per space is the cursor a snapshot hands out and the top a pull
 * compares cursors with; without it a quiet space would look empty, and every
 * client cursor for it would look ahead of the server.
 *
 * Cursors: per space the highest pruned `seq` is recorded in `meta`
 * (`PRUNE_FLOOR_KEY`), in the same transaction as the deletion. A client whose
 * cursor for a space is below that floor misses rows that are gone: it gets a
 * snapshot marked `resync` (protocol 2), or 409 `cursor_ahead` (protocol 1),
 * the same way as after a restored back-up (see restore.ts). A cursor at or
 * above the floor gets a normal delta.
 */

/** The `meta` key with the highest pruned `seq` per space, a JSON object `{ spaceId: seq }`. */
export const PRUNE_FLOOR_KEY = 'sync.pruned_floor'
/** The `meta` key with the moment (ISO) the last pruning finished. */
export const PRUNED_AT_KEY = 'sync.pruned_at'
/** Rows looked at per transaction; the server answers requests between batches. */
export const PRUNE_BATCH = 1000

export type PruneFloors = Record<string, number>

/** The moment one year before `now`: changes received before it are pruned. */
export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime())
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1)
  return cutoff
}

/** Parses the stored floors; anything malformed counts as no floor. */
export function parseFloors(value: string | undefined): PruneFloors {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: PruneFloors = {}
    for (const [space, seq] of Object.entries(parsed)) {
      if (Number.isInteger(seq) && (seq as number) > 0) out[space] = seq as number
    }
    return out
  } catch {
    return {}
  }
}

function readMeta(sqlite: Database.Database, key: string): string | undefined {
  const row = sqlite.prepare('select value from meta where key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

function writeMeta(sqlite: Database.Database, key: string, value: string): void {
  sqlite
    .prepare(
      'insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
    )
    .run(key, value)
}

export function readFloors(sqlite: Database.Database): PruneFloors {
  return parseFloors(readMeta(sqlite, PRUNE_FLOOR_KEY))
}

export interface PruneOptions {
  now?: Date
  batchSize?: number
  /** Called between batches; by default a turn of the event loop, so requests get through. */
  pause?: () => Promise<void>
}

export interface PruneResult {
  removed: number
  floors: PruneFloors
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Deletes changes received more than a year ago, in small transactions, and
 * records the floors. Walks the log by `seq` and stops at the first row that
 * is younger than the cutoff: `received_at` grows with `seq` (the Logbook
 * relies on the same), and walking the primary key keeps each batch cheap on
 * a big database.
 */
export async function pruneChanges(
  sqlite: Database.Database,
  options: PruneOptions = {},
): Promise<PruneResult> {
  const now = options.now ?? new Date()
  const cutoff = retentionCutoff(now).toISOString()
  const batchSize = options.batchSize ?? PRUNE_BATCH
  const pause = options.pause ?? yieldToEventLoop

  // The newest row per space at the start. Rows written later are newer still,
  // so every space keeps at least this one.
  const keep = new Set(
    (
      sqlite.prepare('select max(seq) as seq from changes group by space_id').all() as {
        seq: number
      }[]
    ).map((r) => r.seq),
  )
  const page = sqlite.prepare(
    'select seq, space_id as spaceId, received_at as receivedAt from changes where seq > ? order by seq limit ?',
  )
  const remove = sqlite.prepare('delete from changes where seq = ?')

  let cursor = 0
  let removed = 0
  let done = false
  while (!done) {
    const step = sqlite.transaction(() => {
      const rows = page.all(cursor, batchSize) as {
        seq: number
        spaceId: string
        receivedAt: string
      }[]
      if (rows.length < batchSize) done = true
      const floors = readFloors(sqlite)
      let changed = false
      for (const row of rows) {
        if (row.receivedAt >= cutoff) {
          done = true
          break
        }
        cursor = row.seq
        if (keep.has(row.seq)) continue
        remove.run(row.seq)
        removed += 1
        floors[row.spaceId] = Math.max(floors[row.spaceId] ?? 0, row.seq)
        changed = true
      }
      // In the same transaction as the deletion: a pull never sees rows gone without the floor.
      if (changed) writeMeta(sqlite, PRUNE_FLOOR_KEY, JSON.stringify(floors))
    })
    step()
    if (!done) await pause()
  }

  // Floors of spaces that no longer exist (a demo reset) are of no use.
  const floors = readFloors(sqlite)
  const known = new Set(
    (sqlite.prepare('select id from spaces').all() as { id: string }[]).map((r) => r.id),
  )
  const kept = Object.fromEntries(Object.entries(floors).filter(([space]) => known.has(space)))
  sqlite.transaction(() => {
    if (Object.keys(kept).length !== Object.keys(floors).length) {
      writeMeta(sqlite, PRUNE_FLOOR_KEY, JSON.stringify(kept))
    }
    writeMeta(sqlite, PRUNED_AT_KEY, now.toISOString())
  })()
  return { removed, floors: kept }
}

export interface PrunerOptions {
  timezone: string
  /** The clock; tests pass a fake one. */
  now?: () => number
  /** True while today's nightly back-up is still to be made: pruning waits for it. */
  backupPending?: () => boolean
  batchSize?: number
}

const DAY_MS = 86_400_000

/**
 * Runs `pruneChanges` once per calendar day (in DINGEN_TIMEZONE) from 03:00,
 * after the nightly back-up, and at startup when the last run is more than a
 * day ago. The moment of the last run is kept in `meta`, so a restart does
 * not run it again.
 */
export class ChangeLogPruner {
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<PruneResult | null> | null = null
  private readonly now: () => number

  constructor(
    private readonly sqlite: Database.Database,
    private readonly options: PrunerOptions,
  ) {
    this.now = options.now ?? Date.now
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), BACKUP_TICK_MS)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Due when it never ran, when the last run is a day ago or more (overdue,
   * e.g. at startup), or when it has not run yet today and it is past 03:00.
   * Never while today's back-up is still to be made.
   */
  due(): boolean {
    if (this.options.backupPending?.()) return false
    const last = readMeta(this.sqlite, PRUNED_AT_KEY)
    const lastMs = last ? Date.parse(last) : Number.NaN
    if (Number.isNaN(lastMs)) return true
    const now = this.now()
    if (now - lastMs >= DAY_MS) return true
    const { day, hour } = localDayHour(now, this.options.timezone)
    return hour >= BACKUP_HOUR && localDayHour(lastMs, this.options.timezone).day !== day
  }

  /** One look: prunes when due. Returns what it did, or null. */
  tick(): Promise<PruneResult | null> {
    if (!this.running) {
      this.running = this.run()
        .catch((err) => {
          console.error(
            `Pruning the change log failed; trying again in a few minutes. ${err instanceof Error ? err.message : String(err)}`,
          )
          return null
        })
        .finally(() => {
          this.running = null
        })
    }
    return this.running
  }

  private async run(): Promise<PruneResult | null> {
    if (!this.due()) return null
    const result = await pruneChanges(this.sqlite, {
      now: new Date(this.now()),
      ...(this.options.batchSize ? { batchSize: this.options.batchSize } : {}),
    })
    console.log(`Change log pruned: ${result.removed} change(s) older than a year removed`)
    return result
  }
}
