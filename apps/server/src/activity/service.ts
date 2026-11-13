import type { ACTIVITY_KINDS, ActivityItem, ActorId, AgentGrant, EntityType } from '@dingen/core'
import type Database from 'better-sqlite3'
import { canRead, type Lookup } from '../agents/access.js'
import type { Db } from '../db.js'
import { spacesClause, spacesOf } from '../spaces/service.js'
import {
  ACTIVITY_ENTITY_TYPES,
  type Described,
  describe,
  Folder,
  type Group,
  isCreation,
  type LogRow,
  type Subject,
  sameValue,
} from './derive.js'

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export interface ActivityQuery {
  kinds?: readonly ActivityKind[] | undefined
  actor?: ActorId | undefined
  /** ISO instants; `since` inclusive, `until` inclusive. */
  since?: string | undefined
  until?: string | undefined
  /** Only lines whose `seq` is below this (the `nextBefore` of the previous page). */
  before?: number | undefined
  limit?: number | undefined
}

export interface ActivityPage {
  items: ActivityItem[]
  /** Pass as `before` for the next page; null when there is nothing older. */
  nextBefore: number | null
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100
/** Rows read from the log per database round trip. */
const CHUNK = 500
/**
 * Most rows one request reads. With narrow filters a page may come back short
 * (or empty) with a `nextBefore`; the caller asks again from there.
 */
export const SCAN_BUDGET = 5_000

interface EntityRow {
  data: Record<string, unknown>
  deleted: boolean
}

interface Candidate {
  group: Group
  described: Described
  at: number
}

const TYPES_SQL = ACTIVITY_ENTITY_TYPES.map((t) => `'${t}'`).join(', ')

/**
 * Reads the change log of the user's spaces newest first and turns it into
 * Logbook lines. Cost per request: the log is read through the
 * `(space_id, seq)` index from `before` downwards, in chunks, and only until
 * the page is full (or the scan budget is spent, or `since` is passed); every
 * entity it meets is looked up once through the `(space_id, entity_type, id)`
 * index in `entities` (the materialised state, no replay).
 * The `from` values of updated fields come from one more walk back through the
 * log for just the entities on the page, which stops as soon as every field is
 * found (at the latest at the entity's creation).
 */
export class ActivityService {
  private readonly sqlite: Database.Database

  constructor(private readonly db: Db) {
    // Raw statements: the scan reads in chunks and parses JSON itself.
    this.sqlite = (db as Db & { $client: Database.Database }).$client
  }

  list(userId: string, query: ActivityQuery = {}, grants: readonly AgentGrant[] | null = null) {
    const spaceIds = spacesOf(this.db, userId)
    const scanLog = this.sqlite.prepare(
      `select seq, entity_type as entityType, entity_id as entityId, fields, ts,
              received_at as receivedAt, actor, user_id as userId
         from changes
        where ${spacesClause(spaceIds)} and seq < ? and entity_type in (${TYPES_SQL})
        order by seq desc
        limit ?`,
    )
    const entity = this.sqlite.prepare(
      `select data, deleted from entities
        where ${spacesClause(spaceIds)} and entity_type = ? and id = ?`,
    )
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT))
    const sinceMs = query.since ? Date.parse(query.since) : null
    const untilMs = query.until ? Date.parse(query.until) : null
    const kinds = query.kinds && query.kinds.length > 0 ? new Set(query.kinds) : null
    const cache = new Map<string, EntityRow | null>()
    const load = (type: string, id: string): EntityRow | null => {
      const key = `${type}:${id}`
      if (cache.has(key)) return cache.get(key) ?? null
      const row = entity.get(...spaceIds, type, id) as { data: string; deleted: number } | undefined
      const value = row ? { data: JSON.parse(row.data), deleted: !!row.deleted } : null
      cache.set(key, value)
      return value
    }

    const folder = new Folder(userId)
    const candidates: Candidate[] = []
    const start = query.before ?? Number.MAX_SAFE_INTEGER
    let cursor = start
    let scanned = 0
    let nextBefore: number | null = null
    let done = false

    const accept = (group: Group | null): boolean => {
      if (!group) return false
      const described = describe(group)
      if (!described) return false
      const at = group.latestMs
      if (kinds && !kinds.has(described.kind)) return false
      if (query.actor && group.actor !== query.actor) return false
      if (sinceMs !== null && at < sinceMs) return false
      if (untilMs !== null && at > untilMs) return false
      if (grants !== null && !this.readable(group.subject, grants, load)) return false
      candidates.push({ group, described, at })
      return true
    }

    scan: while (!done) {
      const rows = scanLog.all(...spaceIds, cursor, CHUNK) as (Omit<LogRow, 'fields'> & {
        fields: string
      })[]
      if (rows.length === 0) break
      for (const raw of rows) {
        cursor = raw.seq
        scanned += 1
        const row: LogRow = { ...raw, fields: JSON.parse(raw.fields) }
        // `at` is `receivedAt`, which grows with seq: nothing older can be in the period.
        if (sinceMs !== null && Date.parse(row.receivedAt) < sinceMs) {
          done = true
          break scan
        }
        if (scanned > SCAN_BUDGET) {
          // Stop between groups: the open group is read again, whole, by the next request.
          // A group that already started at the very top is kept, so the next request moves on.
          const open = folder.finish()
          const openTop = open ? (open.rows[0] as LogRow).seq + 1 : null
          if (open && openTop !== null && openTop < start) nextBefore = openTop
          else {
            accept(open)
            nextBefore = row.seq + 1
          }
          return this.build(spaceIds, candidates, nextBefore, load, grants)
        }
        const subject = this.subjectOf(row, load)
        if (!subject) continue
        const closed = folder.push(row, subject)
        if (closed && accept(closed) && candidates.length >= limit) {
          nextBefore = (closed.rows.at(-1) as LogRow).seq
          folder.finish()
          return this.build(spaceIds, candidates, nextBefore, load, grants)
        }
      }
      if (rows.length < CHUNK) break
    }
    accept(folder.finish())
    return this.build(spaceIds, candidates, null, load, grants)
  }

  /** The entity a row counts for, or null when it is not activity (a repeat template). */
  private subjectOf(
    row: LogRow,
    load: (type: string, id: string) => EntityRow | null,
  ): Subject | null {
    if (row.entityType === 'checklistItem') {
      const taskId =
        typeof row.fields.taskId === 'string'
          ? row.fields.taskId
          : load('checklistItem', row.entityId)?.data.taskId
      if (typeof taskId !== 'string') return null
      if (isTemplate(load('task', taskId))) return null
      return { type: 'task', id: taskId }
    }
    if (row.entityType === 'task' && isTemplate(load('task', row.entityId))) return null
    return { type: row.entityType as Subject['type'], id: row.entityId }
  }

  /** The same read check as everywhere else (agents/access.ts), on the cached records. */
  private readable(
    subject: { type: string; id: string },
    grants: readonly AgentGrant[],
    load: (type: string, id: string) => EntityRow | null,
  ): boolean {
    const lookup: Lookup = (entityType, id) => {
      const row = load(entityType, id)
      return row ? { entityType, id, data: row.data, fieldTs: {} } : undefined
    }
    const record = lookup(subject.type as EntityType, subject.id)
    return record !== undefined && canRead([...grants], record, lookup)
  }

  private container(
    subject: Subject,
    load: (type: string, id: string) => EntityRow | null,
  ): ActivityItem['container'] {
    const data = load(subject.type, subject.id)?.data
    if (!data) return null
    const make = (type: 'project' | 'area', id: unknown): ActivityItem['container'] => {
      if (typeof id !== 'string') return null
      const title = load(type, id)?.data.title
      return { type, id, title: typeof title === 'string' ? title : '' }
    }
    switch (subject.type) {
      case 'area':
        return null
      case 'project':
        return make('area', data.areaId)
      case 'heading':
        return make('project', data.projectId)
      case 'task': {
        const projectId = taskProjectId(data, load)
        return projectId ? make('project', projectId) : make('area', data.areaId)
      }
    }
  }

  /** Fills in titles, containers and the `from` values, and drops lines that changed nothing. */
  private build(
    spaceIds: string[],
    candidates: Candidate[],
    nextBefore: number | null,
    load: (type: string, id: string) => EntityRow | null,
    grants: readonly AgentGrant[] | null,
  ): ActivityPage {
    const previous = this.previousValues(spaceIds, candidates)
    const items: ActivityItem[] = []
    candidates.forEach((c, i) => {
      const { group, described } = c
      const before = previous[i]
      const fields = described.changed
        .map(({ field, to }) => ({
          field,
          from: field === 'checklist' || field === 'notes' ? null : (before?.get(field) ?? null),
          to: field === 'checklist' || field === 'notes' ? null : to,
        }))
        .filter(
          (f) =>
            f.field === 'checklist' ||
            f.field === 'notes' ||
            !before?.has(f.field) ||
            !sameValue(f.from, f.to),
        )
      if (described.kind === 'updated' && fields.length === 0) return
      const title = load(group.subject.type, group.subject.id)?.data.title
      // An agent only sees the project or area around an entity when it can read that too.
      let container = this.container(group.subject, load)
      if (container && grants !== null && !this.readable(container, grants, load)) {
        container = null
      }
      items.push({
        seq: (group.rows[0] as LogRow).seq,
        at: new Date(c.at).toISOString(),
        actor: group.actor,
        kind: described.kind,
        entityType: group.subject.type,
        entityId: group.subject.id,
        title: typeof title === 'string' ? title : '',
        container,
        fields,
      })
    })
    return { items, nextBefore }
  }

  /**
   * For every updated line: the value each changed field had just before the
   * line's first change. One walk back through the log, limited to the entities
   * on the page; it ends when every field has been found.
   */
  private previousValues(
    spaceIds: string[],
    candidates: Candidate[],
  ): (Map<string, unknown> | null)[] {
    interface Need {
      index: number
      type: string
      id: string
      minSeq: number
      open: Set<string>
      found: Map<string, unknown>
    }
    const needs: Need[] = []
    const result: (Map<string, unknown> | null)[] = candidates.map(() => null)
    candidates.forEach((c, index) => {
      if (c.described.kind !== 'updated') return
      const fields = c.described.changed
        .map((f) => f.field)
        .filter((f) => f !== 'checklist' && f !== 'notes')
      const own = c.group.rows.filter((r) => r.entityType === c.group.subject.type)
      if (fields.length === 0 || own.length === 0) return
      const found = new Map<string, unknown>()
      result[index] = found
      needs.push({
        index,
        type: c.group.subject.type,
        id: c.group.subject.id,
        minSeq: (own.at(-1) as LogRow).seq,
        open: new Set(fields),
        found,
      })
    })
    if (needs.length === 0) return result

    const ids = [...new Set(needs.map((n) => n.id))]
    const start = Math.max(...needs.map((n) => n.minSeq))
    const stmt = this.sqlite.prepare(
      `select seq, entity_type as entityType, entity_id as entityId, fields, ts,
              received_at as receivedAt, actor, user_id as userId
         from changes
        where ${spacesClause(spaceIds)} and seq < ? and entity_id in (${ids.map(() => '?').join(', ')})
        order by seq desc
        limit ?`,
    )
    let cursor = start
    let pending = needs.length
    while (pending > 0) {
      const rows = stmt.all(...spaceIds, cursor, ...ids, CHUNK) as (Omit<LogRow, 'fields'> & {
        fields: string
      })[]
      for (const raw of rows) {
        cursor = raw.seq
        const row: LogRow = { ...raw, fields: JSON.parse(raw.fields) }
        for (const need of needs) {
          if (need.open.size === 0 || need.id !== row.entityId || need.type !== row.entityType)
            continue
          if (row.seq >= need.minSeq) continue
          for (const field of [...need.open]) {
            if (field in row.fields) {
              need.found.set(field, row.fields[field])
              need.open.delete(field)
            }
          }
          // Nothing is older than the creation: a field it did not set had no value.
          if (isCreation(row)) need.open.clear()
          if (need.open.size === 0) pending -= 1
        }
        if (pending === 0) break
      }
      if (rows.length < CHUNK) break
    }
    return result
  }
}

function isTemplate(row: EntityRow | null): boolean {
  return row?.data.repeat !== null && row?.data.repeat !== undefined
}

function taskProjectId(
  data: Record<string, unknown>,
  load: (type: string, id: string) => EntityRow | null,
): string | null {
  if (typeof data.projectId === 'string') return data.projectId
  if (typeof data.headingId === 'string') {
    const projectId = load('heading', data.headingId)?.data.projectId
    if (typeof projectId === 'string') return projectId
  }
  return null
}
