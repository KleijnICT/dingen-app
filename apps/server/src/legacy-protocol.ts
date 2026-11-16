import {
  applyChange,
  type Change,
  downgradeTaskData,
  downgradeTaskFields,
  type EntityRecord,
  type EntityType,
  type PullResponse,
  recordKey,
  type SnapshotResponse,
  SYNC_PROTOCOL,
  upgradeTaskFields,
} from '@dingen/core'
import type { PullResult } from './sync.js'

/**
 * The move from sync protocol 2 to 3 (plan 25), in the HTTP layer: the sync
 * service itself only knows protocol 3.
 *
 * - Pushes: task fields `evening` and `time` (protocol 2) become a daypart and,
 *   for a time, a reminder (`upgradeTaskFields`). Whatever client sends them:
 *   they are not valid in protocol 3, so converting is always safe.
 * - Pulls and snapshots for a client that does not say it speaks protocol 3
 *   (no `x-dingen-protocol` header): tasks get a derived `evening` and
 *   `time: null`, which their schema requires. `daypart` and `duration` stay;
 *   the old schemas are not strict and drop them.
 *
 * This can go once no released client speaks protocol 2 (the web app and the
 * MCP plugin from 1.0.0-alpha.5 and older).
 */

/** Does a request with this protocol need tasks in protocol 2 form? */
export function needsLegacyTasks(protocol: number): boolean {
  return protocol < SYNC_PROTOCOL
}

/**
 * Pushed task changes with `evening` or `time` in protocol 3 terms. `current`
 * gives a task as stored (for the reminder and the daypart it already has);
 * changes earlier in the batch count too. Other changes come back as they are.
 */
export function upgradePushedChanges(
  incoming: Change[],
  current: (entityType: EntityType, id: string) => EntityRecord | undefined,
): Change[] {
  const legacy = (c: Change) =>
    c.entityType === 'task' && ('evening' in c.fields || 'time' in c.fields)
  if (!incoming.some(legacy)) return incoming
  const seen = new Map<string, EntityRecord | undefined>()
  return incoming.map((change) => {
    if (change.entityType !== 'task') return change
    const key = recordKey(change.entityType, change.entityId)
    const before = seen.has(key) ? seen.get(key) : current(change.entityType, change.entityId)
    const out = legacy(change)
      ? { ...change, fields: upgradeTaskFields(change.fields, before?.data) }
      : change
    seen.set(key, applyChange(before, out))
    return out
  })
}

function legacyChange(change: Change): Change {
  if (change.entityType !== 'task') return change
  const fields = downgradeTaskFields(change.fields)
  return fields === change.fields ? change : { ...change, fields }
}

function legacyRecord<T extends EntityRecord>(record: T): T {
  if (record.entityType !== 'task') return record
  return { ...record, data: downgradeTaskData(record.data) }
}

/** A protocol 1 pull (`since=`) for a protocol 2 client. */
export function legacyPull(result: PullResult): PullResult {
  return { ...result, changes: result.changes.map(legacyChange) }
}

/** A protocol 2 pull (`cursor=`) for a protocol 2 client. */
export function legacyPullSpaces(result: PullResponse): PullResponse {
  return {
    ...result,
    spaces: result.spaces.map((space) => ({
      ...space,
      changes: space.changes.map(legacyChange),
      ...(space.entities ? { entities: space.entities.map(legacyRecord) } : {}),
      ...(space.arrived ? { arrived: space.arrived.map(legacyRecord) } : {}),
    })),
  }
}

/** A snapshot for a protocol 2 client. */
export function legacySnapshot(result: SnapshotResponse): SnapshotResponse {
  return { ...result, entities: result.entities.map(legacyRecord) }
}
