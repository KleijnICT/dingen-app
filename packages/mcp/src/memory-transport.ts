import {
  applyChange,
  type Change,
  type EntityRecord,
  type PullResponse,
  type PushResponse,
  recordKey,
  type SnapshotResponse,
  type SpaceCursor,
  SYNC_PROTOCOL,
} from '@dingen/core'
import type { SyncTransport } from './client.js'

/** The one space of a `MemoryTransport`. */
export const MEMORY_SPACE = 'personal'

/**
 * The sync protocol in memory, with one personal space: enough to run the
 * client and the tools without a server (tests, dry runs).
 */
export class MemoryTransport implements SyncTransport {
  readonly records = new Map<string, EntityRecord>()
  readonly log: Change[] = []

  async snapshot(): Promise<SnapshotResponse> {
    return {
      protocol: SYNC_PROTOCOL,
      entities: [...this.records.values()].map((r) => ({ ...r, spaceId: MEMORY_SPACE })),
      spaces: [{ id: MEMORY_SPACE, kind: 'personal', level: 'manage' }],
      cursor: { [MEMORY_SPACE]: this.log.length },
    }
  }

  async pullSpaces(cursor: SpaceCursor): Promise<PullResponse> {
    const since = cursor[MEMORY_SPACE] ?? 0
    const seq = this.log.length
    return {
      protocol: SYNC_PROTOCOL,
      spaces: [
        {
          id: MEMORY_SPACE,
          kind: 'personal',
          level: 'manage',
          seq,
          changes: this.log.slice(since),
          hasMore: false,
        },
      ],
      removed: [],
      cursor: { [MEMORY_SPACE]: seq },
      hasMore: false,
    }
  }

  async push(changes: Change[]): Promise<PushResponse> {
    for (const change of changes) {
      const key = recordKey(change.entityType, change.entityId)
      this.records.set(key, applyChange(this.records.get(key), change))
      this.log.push(change)
    }
    return { applied: changes.length, duplicates: 0 }
  }
}
