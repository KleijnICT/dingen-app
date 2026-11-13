import {
  type Change,
  createClock,
  type EntityType,
  normalizeTagTitle,
  SYSTEM_ACTOR,
  ulid,
} from '@dingen/core'
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db.js'
import { entities, meta, spaces } from '../schema.js'
import { SyncService } from '../sync.js'

/**
 * Tag names in lowercase (plan 23, decision 4b), for data from before that
 * rule. Per space: every tag title becomes its lowercase form, and tags that
 * then have the same name under the same parent become one tag (the oldest
 * stays). Tasks and projects point to the tag that stays, children of a
 * removed tag move under it, and the removed tags are deleted. Everything goes
 * through the change log with `system` as actor, so clients sync it and the
 * Logbook shows who did it. A SQL migration cannot do this: it would bypass
 * the log.
 */

/** The `meta` key that records that the one-time migration ran. */
export const LOWERCASE_TAGS_KEY = 'data_migration.lowercase_tags'

/** The client id in the HLC stamps of the server's own changes (`[0-9A-Z]+`). */
const SYSTEM_CLIENT = 'SYSTEM'

export interface TagRow {
  id: string
  title: string
  parentId: string | null
  createdAt: string
}

export interface TagCleanup {
  /** Tags that stay but change: a lowercase title and/or a new parent. */
  updates: Map<string, { title?: string; parentId?: string | null }>
  /** Removed tag id → the tag that stays in its place. */
  merged: Map<string, string>
}

const oldestFirst = (a: TagRow, b: TagRow) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1

/**
 * Which tags of one space change (pure). Tags merge when their normalized
 * titles are equal and their parents are the same after merging, so merging
 * two parents can make their children equal too; repeated until stable.
 */
export function planTagCleanup(tags: TagRow[]): TagCleanup {
  const merged = new Map<string, string>()
  const keeperOf = (id: string): string => {
    let current = id
    for (let next = merged.get(current); next; next = merged.get(current)) current = next
    return current
  }
  const ordered = [...tags].sort(oldestFirst)
  for (let changed = true; changed; ) {
    changed = false
    const seen = new Map<string, string>()
    for (const tag of ordered) {
      if (merged.has(tag.id)) continue
      const title = normalizeTagTitle(tag.title)
      if (!title) continue
      const key = `${tag.parentId ? keeperOf(tag.parentId) : ''}\u0000${title}`
      const keeper = seen.get(key)
      if (keeper) {
        merged.set(tag.id, keeper)
        changed = true
      } else {
        seen.set(key, tag.id)
      }
    }
  }

  const updates: TagCleanup['updates'] = new Map()
  for (const tag of tags) {
    if (merged.has(tag.id)) continue
    const fields: { title?: string; parentId?: string | null } = {}
    const title = normalizeTagTitle(tag.title)
    if (title && title !== tag.title) fields.title = title
    if (tag.parentId && merged.has(tag.parentId)) {
      const parent = keeperOf(tag.parentId)
      fields.parentId = parent === tag.id ? null : parent
    }
    if (Object.keys(fields).length > 0) updates.set(tag.id, fields)
  }
  // Report each removed tag with its final keeper.
  for (const id of merged.keys()) merged.set(id, keeperOf(id))
  return { updates, merged }
}

export interface TagCleanupResult {
  spaces: number
  renamed: number
  merged: number
  retagged: number
}

interface Row {
  type: EntityType
  id: string
  data: Record<string, unknown>
  fieldTs: Record<string, string>
}

/**
 * Applies `planTagCleanup` to the live tags of each space (all spaces, or the
 * given ones) and writes the result as changes by `system`, pushed as the
 * space's owner. Running it again changes nothing.
 */
export function lowercaseTags(db: Db, spaceIds?: readonly string[]): TagCleanupResult {
  const sync = new SyncService(db)
  const result: TagCleanupResult = { spaces: 0, renamed: 0, merged: 0, retagged: 0 }
  const rows = db
    .select({ id: spaces.id, ownerId: spaces.ownerId })
    .from(spaces)
    .where(spaceIds ? inArray(spaces.id, [...spaceIds]) : undefined)
    .all()

  for (const space of rows) {
    const live = (types: EntityType[]): Row[] =>
      db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.spaceId, space.id),
            inArray(entities.entityType, types),
            eq(entities.deleted, false),
          ),
        )
        .all()
        .map((r) => ({
          type: r.entityType as EntityType,
          id: r.id,
          data: r.data,
          fieldTs: r.fieldTs,
        }))

    const tagRows = live(['tag'])
    const plan = planTagCleanup(
      tagRows.map((r) => ({
        id: r.id,
        title: typeof r.data.title === 'string' ? r.data.title : '',
        parentId: typeof r.data.parentId === 'string' ? r.data.parentId : null,
        createdAt: typeof r.data.createdAt === 'string' ? r.data.createdAt : '',
      })),
    )
    if (plan.updates.size === 0 && plan.merged.size === 0) continue

    const pending: { row: Row; fields: Record<string, unknown> }[] = []
    const tagById = new Map(tagRows.map((r) => [r.id, r]))
    for (const [id, fields] of plan.updates) {
      const row = tagById.get(id)
      if (row) pending.push({ row, fields })
    }
    let retagged = 0
    if (plan.merged.size > 0) {
      for (const row of live(['task', 'project'])) {
        const tagIds = Array.isArray(row.data.tagIds) ? (row.data.tagIds as string[]) : []
        if (!tagIds.some((id) => plan.merged.has(id))) continue
        const next = [...new Set(tagIds.map((id) => plan.merged.get(id) ?? id))]
        pending.push({ row, fields: { tagIds: next } })
        retagged += 1
      }
      for (const id of plan.merged.keys()) {
        const row = tagById.get(id)
        if (row) pending.push({ row, fields: { deleted: true } })
      }
    }

    // Stamps after everything these entities have seen, so the changes win.
    const clock = createClock(SYSTEM_CLIENT)
    for (const { row } of pending) {
      for (const ts of Object.values(row.fieldTs)) clock.receive(ts)
    }
    const changes: Change[] = pending.map(({ row, fields }) => ({
      id: ulid(),
      entityType: row.type,
      entityId: row.id,
      fields,
      ts: clock.now(),
      clientId: SYSTEM_CLIENT,
    }))
    sync.push(space.ownerId, changes, {
      access: { userId: space.ownerId, actor: SYSTEM_ACTOR, grants: null },
    })

    result.spaces += 1
    result.renamed += [...plan.updates.values()].filter((f) => f.title !== undefined).length
    result.merged += plan.merged.size
    result.retagged += retagged
  }
  return result
}

/**
 * The one-time migration at server start (after the SQL migrations): runs
 * `lowercaseTags` over all spaces unless `meta` says it already ran, then
 * records that. Returns null when it had already run.
 */
export function migrateLowercaseTags(db: Db, now = new Date()): TagCleanupResult | null {
  const done = db.select().from(meta).where(eq(meta.key, LOWERCASE_TAGS_KEY)).get()
  if (done) return null
  const result = lowercaseTags(db)
  const value = JSON.stringify({ at: now.toISOString(), ...result })
  db.insert(meta)
    .values({ key: LOWERCASE_TAGS_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run()
  return result
}
