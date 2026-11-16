import {
  type Change,
  createClock,
  RETIRED_FIELDS,
  SYSTEM_ACTOR,
  ulid,
  upgradeTaskFields,
  withoutRetired,
} from '@dingen/core'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db.js'
import { entities, meta, spaces } from '../schema.js'
import { SyncService } from '../sync.js'

/**
 * Dayparts instead of evening and time (plan 25), for data from before
 * protocol 3. Per live task:
 *
 * 1. `evening: true` → daypart evening.
 * 2. A `time` → the daypart it falls in; a task without a reminder gets one
 *    at that time on the day itself, so no notification gets lost. Existing
 *    reminders stay as they are, so they go off at the same moment.
 * 3. `evening` and `time` go (`duration` is null by default).
 *
 * Steps 1 and 2 go through the change log with `system` as actor, so clients
 * sync them and the Logbook shows who did it (`upgradeTaskFields`, the same
 * conversion as for pushes from old clients). Step 3 removes the two fields
 * from the stored tasks (also deleted ones): a field cannot be removed with a
 * change, and protocol 3 validation does not know them.
 */

/** The `meta` key that records that the one-time migration ran. */
export const DAYPARTS_KEY = 'data_migration.dayparts'

/** The client id in the HLC stamps of the server's own changes (`[0-9A-Z]+`). */
const SYSTEM_CLIENT = 'SYSTEM'

export interface DaypartResult {
  /** Spaces where tasks changed. */
  spaces: number
  /** Tasks that got the evening daypart from `evening`. */
  evening: number
  /** Tasks that got a daypart from their time. */
  timed: number
  /** Tasks that got a reminder at their time. */
  reminders: number
  /** Stored tasks the old fields were removed from. */
  cleaned: number
}

interface Pending {
  id: string
  fields: Record<string, unknown>
  fieldTs: Record<string, string>
}

/** Converts the tasks of all spaces (or the given ones); running it again changes nothing. */
export function convertToDayparts(db: Db, spaceIds?: readonly string[]): DaypartResult {
  const sync = new SyncService(db)
  const result: DaypartResult = { spaces: 0, evening: 0, timed: 0, reminders: 0, cleaned: 0 }
  const retired = RETIRED_FIELDS.task ?? []
  const rows = db.select({ id: spaces.id, ownerId: spaces.ownerId }).from(spaces).all()

  for (const space of rows) {
    if (spaceIds && !spaceIds.includes(space.id)) continue
    const tasks = db
      .select()
      .from(entities)
      .where(and(eq(entities.spaceId, space.id), eq(entities.entityType, 'task')))
      .all()
      .filter((row) => retired.some((field) => field in row.data))
    if (tasks.length === 0) continue

    const pending: Pending[] = []
    for (const row of tasks) {
      if (row.deleted) continue
      const legacy: Record<string, unknown> = {}
      if (row.data.evening === true) legacy.evening = true
      if (typeof row.data.time === 'string') legacy.time = row.data.time
      if (Object.keys(legacy).length === 0) continue
      const fields = upgradeTaskFields(legacy, withoutRetired('task', row.data))
      if (Object.keys(fields).length === 0) continue
      pending.push({ id: row.id, fields, fieldTs: row.fieldTs })
      if (fields.daypart === 'evening' && legacy.evening === true) result.evening += 1
      else if (fields.daypart !== undefined) result.timed += 1
      if (fields.reminder !== undefined) result.reminders += 1
    }

    // Step 3 first, so the changes validate against tasks without the old fields.
    db.transaction((tx) => {
      for (const row of tasks) {
        const fieldTs = { ...row.fieldTs }
        for (const field of retired) delete fieldTs[field]
        tx.update(entities)
          .set({ data: withoutRetired('task', row.data), fieldTs })
          .where(
            and(
              eq(entities.userId, row.userId),
              eq(entities.entityType, 'task'),
              eq(entities.id, row.id),
            ),
          )
          .run()
      }
    })
    result.cleaned += tasks.length

    if (pending.length === 0) continue
    // Stamps after everything these tasks have seen, so the changes win.
    const clock = createClock(SYSTEM_CLIENT)
    for (const { fieldTs } of pending) {
      for (const ts of Object.values(fieldTs)) clock.receive(ts)
    }
    const changes: Change[] = pending.map(({ id, fields }) => ({
      id: ulid(),
      entityType: 'task',
      entityId: id,
      fields,
      ts: clock.now(),
      clientId: SYSTEM_CLIENT,
    }))
    sync.push(space.ownerId, changes, {
      access: { userId: space.ownerId, actor: SYSTEM_ACTOR, grants: null },
    })
    result.spaces += 1
  }
  return result
}

/**
 * The one-time migration at server start (after the SQL migrations): runs
 * `convertToDayparts` over all spaces unless `meta` says it already ran, then
 * records that. Returns null when it had already run.
 */
export function migrateDayparts(db: Db, now = new Date()): DaypartResult | null {
  const done = db.select().from(meta).where(eq(meta.key, DAYPARTS_KEY)).get()
  if (done) return null
  const result = convertToDayparts(db)
  const value = JSON.stringify({ at: now.toISOString(), ...result })
  db.insert(meta)
    .values({ key: DAYPARTS_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run()
  return result
}
