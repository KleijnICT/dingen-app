import type { Change, EntityRecord } from '@dingen/core'
import Dexie, { type EntityTable } from 'dexie'

/** Een entiteit in de lokale replica; `key` is `entityType:id`. */
export interface StoredRecord extends EntityRecord {
  key: string
}

/** Een nog niet gepushte wijziging. `order` bewaart de volgorde van ontstaan. */
export interface OutboxItem {
  id: string
  order: number
  change: Change
}

export interface MetaItem {
  key: 'clientId' | 'cursor'
  value: string | number
}

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
