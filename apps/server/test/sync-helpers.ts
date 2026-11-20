import type { AgentGrant, Change } from '@dingen/core'
import { max } from 'drizzle-orm'
import type { Db } from '../src/db.js'
import { changes } from '../src/schema.js'
import type { SyncService } from '../src/sync.js'

/** The highest `seq` in the change log (0 when empty). */
export function lastSeq(db: Db): number {
  return (
    db
      .select({ seq: max(changes.seq) })
      .from(changes)
      .get()?.seq ?? 0
  )
}

/**
 * Every change a user can pull after `seq` (over all their spaces, space by
 * space), as a client with that cursor in every space would get them. Moves
 * come as `arrived` and `left`, not as changes: see `pullSpaces`.
 */
export function changesSince(
  sync: SyncService,
  userId: string,
  seq = 0,
  grants: AgentGrant[] | null = null,
): Change[] {
  const top = sync.snapshot(userId, grants).cursor
  let cursor = Object.fromEntries(Object.entries(top).map(([id, s]) => [id, Math.min(seq, s)]))
  const out: Change[] = []
  for (let more = true; more; ) {
    const body = sync.pullSpaces(userId, cursor, undefined, grants)
    for (const space of body.spaces) out.push(...space.changes)
    cursor = body.cursor
    more = body.hasMore
  }
  return out
}
