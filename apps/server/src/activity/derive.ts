import type { ActivityItem, MemberId } from '@dingen/core'

/**
 * Activity (plan 19, part D): turning the change log into Logbook lines.
 * This file is pure; `service.ts` feeds it rows from the database.
 *
 * A line is a *group*: consecutive log rows (in `seq` order, after skipping
 * rows that are not activity) that touch the same entity by the same actor,
 * with at most `FOLD_GAP_MS` between two rows and `FOLD_SPAN_MS` in total.
 * Because a group is always a run of consecutive rows, paging on `seq` cuts
 * cleanly between groups and every page folds exactly as the full log would.
 */

export const FOLD_GAP_MS = 5 * 60_000
/** A long editing session still splits now and then, so the line keeps a sensible time. */
export const FOLD_SPAN_MS = 60 * 60_000

/** The entity types that show up in the Logbook; checklist items roll up into their task. */
export const ACTIVITY_ENTITY_TYPES = [
  'task',
  'project',
  'area',
  'heading',
  'checklistItem',
] as const

/** Fields that only keep the app running; shown only when nothing else changed. */
const BOOKKEEPING = new Set(['order', 'todayOrder'])
/** Fields that are implied by the kind of the line, or never interesting. */
const IMPLIED = new Set(['id', 'createdAt', 'completedAt', 'deleted', 'status'])

export interface LogRow {
  seq: number
  entityType: string
  entityId: string
  fields: Record<string, unknown>
  ts: string
  receivedAt: string
  actor: string | null
}

/** The entity a row counts for in the Logbook (a checklist item counts for its task). */
export interface Subject {
  type: 'task' | 'project' | 'area' | 'heading'
  id: string
}

export interface Group {
  subject: Subject
  actor: MemberId
  /** Newest first. */
  rows: LogRow[]
  /** Time of the newest row, ms. */
  latestMs: number
  /** Time of the oldest row, ms. */
  earliestMs: number
}

/**
 * When a change happened: the moment the server received it. Lines are ordered
 * and paged on `seq`, and `receivedAt` grows with `seq`, so times and day
 * groups always follow the order of the list. The HLC wall time would be
 * closer for offline edits, but it does not follow `seq`: an import writes
 * months of history in entity order, and an offline device syncs yesterday's
 * edits today, which would scatter days through the list. The service also
 * relies on this to stop reading once it is past `since`.
 */
export function changeTimeMs(row: Pick<LogRow, 'receivedAt'>): number {
  return Date.parse(row.receivedAt)
}

/** A missing actor is the owner: rows from before plan 19 and sessions without one. */
export function actorOf(row: LogRow, ownerId: string): MemberId {
  const a = row.actor
  return a && (a.startsWith('user:') || a.startsWith('agent:'))
    ? (a as MemberId)
    : `user:${ownerId}`
}

/** A row creates its entity when it carries `createdAt`: only a whole new entity sends that. */
export function isCreation(row: LogRow): boolean {
  return 'createdAt' in row.fields
}

/**
 * Folds rows, newest first, into groups. `push` returns the group that the row
 * closed (the row then starts a new one); `finish` returns the last open group.
 */
export class Folder {
  private open: Group | null = null

  constructor(private readonly ownerId: string) {}

  get current(): Group | null {
    return this.open
  }

  push(row: LogRow, subject: Subject): Group | null {
    const actor = actorOf(row, this.ownerId)
    const at = changeTimeMs(row)
    const g = this.open
    if (
      g &&
      g.subject.type === subject.type &&
      g.subject.id === subject.id &&
      g.actor === actor &&
      // The group already starts with the creation; nothing older belongs to it.
      !g.rows.some((r) => r.entityType === g.subject.type && isCreation(r)) &&
      g.earliestMs - at <= FOLD_GAP_MS &&
      g.latestMs - at <= FOLD_SPAN_MS
    ) {
      g.rows.push(row)
      g.earliestMs = Math.min(g.earliestMs, at)
      return null
    }
    this.open = { subject, actor, rows: [row], latestMs: at, earliestMs: at }
    return g
  }

  finish(): Group | null {
    const g = this.open
    this.open = null
    return g
  }
}

export interface Described {
  kind: ActivityItem['kind']
  /** Changed fields with the value after the group; `from` is filled in later. */
  changed: { field: string; to: unknown }[]
}

/** The fields of the subject itself (not of its checklist items), oldest first, merged. */
export function ownFields(group: Group): Map<string, unknown> {
  const after = new Map<string, unknown>()
  for (let i = group.rows.length - 1; i >= 0; i--) {
    const row = group.rows[i] as LogRow
    if (row.entityType !== group.subject.type) continue
    for (const [field, value] of Object.entries(row.fields)) after.set(field, value)
  }
  return after
}

/** The kind of line a group becomes, and which fields it shows. */
export function describe(group: Group): Described | null {
  const own = group.rows.filter((r) => r.entityType === group.subject.type)
  const created = own.some(isCreation)
  const after = ownFields(group)
  const checklist = group.rows.some((r) => r.entityType === 'checklistItem')

  if (after.get('deleted') === true) return { kind: 'deleted', changed: [] }
  if (created) return { kind: 'added', changed: [] }
  if (after.has('status')) {
    const status = after.get('status')
    if (status === 'open') return { kind: 'reopened', changed: [] }
    return { kind: 'completed', changed: [{ field: 'status', to: status }] }
  }

  const changed: { field: string; to: unknown }[] = []
  for (const [field, to] of after) {
    if (IMPLIED.has(field) || BOOKKEEPING.has(field)) continue
    changed.push({ field, to })
  }
  if (after.get('deleted') === false) changed.push({ field: 'deleted', to: false })
  if (checklist) changed.push({ field: 'checklist', to: null })
  if (changed.length === 0) {
    for (const [field, to] of after) if (BOOKKEEPING.has(field)) changed.push({ field, to })
  }
  if (changed.length === 0) return null
  return { kind: 'updated', changed }
}

/** Values compare as JSON: they all came from JSON. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}
