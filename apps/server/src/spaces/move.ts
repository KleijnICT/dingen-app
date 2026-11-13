import { createHash } from 'node:crypto'
import {
  type Change,
  type EntityRecord,
  type EntityType,
  formatTimestamp,
  parseTimestamp,
  recordKey,
  type Timestamp,
} from '@dingen/core'

/**
 * Moving between spaces (plan 23, part 3): the pure parts. `SyncService`
 * does the reading and writing.
 *
 * A move of entity E from space A to space B writes, per entity that moves
 * (E and its children):
 * - a *leave* row in A: fields `{ spaceId: B }`;
 * - an *arrival* row in B: fields `{ spaceId: B }` (for E also the other
 *   fields of the pushed change, and the pushed change's id);
 * - when needed, a *fix* row in B: references to containers that stayed
 *   behind set to null, and tags swapped for the tags of B.
 * A row with a `spaceId` field is a move row; it is an arrival when its own
 * space is that `spaceId`, else a leave. Pulls render move rows per viewer
 * (see `SyncService`), never as plain changes.
 */

/** `clientId` of the rows the server writes along with a move; the Logbook skips them. */
export const SERVER_CLIENT_ID = 'server'

/** The entity types that can be moved on their own; the others move with them. */
export const MOVABLE: readonly EntityType[] = ['area', 'project', 'task']

/** Is this stored change a move row (leave or arrival)? */
export function isMoveRow(fields: Record<string, unknown>): fields is { spaceId: string } {
  return typeof fields.spaceId === 'string'
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A deterministic id in ULID form for a row derived from something else. */
export function derivedId(seed: string): string {
  const hash = createHash('sha256').update(seed).digest()
  let out = ''
  for (let i = 0; i < 26; i++) out += CROCKFORD[(hash[i] ?? 0) & 31]
  return out
}

/** A timestamp just after `ts` (same wall time and client, counter + `by`). */
export function after(ts: Timestamp, by = 1): Timestamp {
  const { wall, counter, clientId } = parseTimestamp(ts)
  return formatTimestamp(wall, counter + by, clientId)
}

/** The latest of some timestamps (they compare as strings). */
export function latest(first: Timestamp, ...rest: Timestamp[]): Timestamp {
  let out = first
  for (const ts of rest) if (ts > out) out = ts
  return out
}

/** The fields of an entity that point at a container, with the type they point at. */
export function containerRefs(type: EntityType): readonly [string, EntityType][] {
  switch (type) {
    case 'task':
      return [
        ['projectId', 'project'],
        ['headingId', 'heading'],
        ['areaId', 'area'],
        ['templateId', 'task'],
      ]
    case 'project':
      return [['areaId', 'area']]
    case 'heading':
      return [['projectId', 'project']]
    case 'checklistItem':
      return [['taskId', 'task']]
    default:
      return []
  }
}

/**
 * The live entities that move along with `root`, parents before children:
 * an area takes its projects and its loose tasks, a project its headings and
 * tasks, a heading its tasks, a task its checklist items and the instances of
 * its repeat rule. `live` is every live entity of the root's space.
 */
export function childrenOf(root: EntityRecord, live: readonly EntityRecord[]): EntityRecord[] {
  const byParent = new Map<string, EntityRecord[]>()
  const link = (parentKey: string, child: EntityRecord) => {
    const list = byParent.get(parentKey) ?? []
    list.push(child)
    byParent.set(parentKey, list)
  }
  for (const rec of live) {
    for (const [field, type] of containerRefs(rec.entityType)) {
      const id = rec.data[field]
      if (typeof id === 'string') link(recordKey(type, id), rec)
    }
  }
  const seen = new Set([recordKey(root.entityType, root.id)])
  const out: EntityRecord[] = []
  const queue = [root]
  for (let next = queue.shift(); next; next = queue.shift()) {
    for (const child of byParent.get(recordKey(next.entityType, next.id)) ?? []) {
      const key = recordKey(child.entityType, child.id)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/**
 * Protocol 1 has no `arrived`: an entity that moved into the viewer's sight
 * comes as plain changes, one per distinct field timestamp, so last-writer-
 * wins keeps working. `deleted` goes at the move's own time at least, so it
 * beats the deletion an earlier move out of sight may have left behind.
 */
export function arrivalAsChanges(
  row: { id: string; ts: Timestamp; clientId: string },
  record: EntityRecord,
): Change[] {
  const byTs = new Map<Timestamp, Record<string, unknown>>()
  for (const [field, value] of Object.entries(record.data)) {
    if (field === 'id') continue
    let ts = record.fieldTs[field]
    if (field === 'deleted') ts = latest(row.ts, ts ?? row.ts)
    if (!ts) continue
    const group = byTs.get(ts) ?? {}
    group[field] = value
    byTs.set(ts, group)
  }
  return [...byTs.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ts, fields]) => ({
      id: derivedId(`${row.id}:p1:${ts}`),
      entityType: record.entityType,
      entityId: record.id,
      fields,
      ts,
      clientId: row.clientId,
    }))
}
