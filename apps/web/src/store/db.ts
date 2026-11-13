import type { Change, EntityRecord, SpaceCursor } from '@dingen/core'
import Dexie, { type EntityTable } from 'dexie'

/**
 * A record in the replica with the space it lives in, as far as the server
 * told us. No `spaceId` means the personal space: records stored before
 * protocol 2, and new ones the server has not answered for yet (its push
 * answer says where they landed: the space of their container, or the
 * personal space).
 */
export interface LocalRecord extends EntityRecord {
  spaceId?: string
}

/** Een entiteit in de lokale replica; `key` is `entityType:id`. */
export interface StoredRecord extends LocalRecord {
  key: string
}

/** Een nog niet gepushte wijziging. `order` bewaart de volgorde van ontstaan. */
export interface OutboxItem {
  id: string
  order: number
  change: Change
}

/**
 * `cursors` is the sync cursor per space (protocol 2). `cursor` is the single
 * cursor of protocol 1: read once to move over, then removed.
 */
export type MetaItem =
  | { key: 'clientId'; value: string }
  | { key: 'cursor'; value: number }
  | { key: 'cursors'; value: SpaceCursor }

/** IndexedDB via Dexie: één database per gebruiker, zodat accounts in dezelfde browser gescheiden blijven. */
export class LocalDb extends Dexie {
  entities!: EntityTable<StoredRecord, 'key'>
  outbox!: EntityTable<OutboxItem, 'id'>
  meta!: EntityTable<MetaItem, 'key'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      entities: 'key, entityType',
      outbox: 'id, order',
      meta: 'key',
    })
  }
}

export function dbNameFor(userId: string): string {
  return `dingen-${userId}`
}
