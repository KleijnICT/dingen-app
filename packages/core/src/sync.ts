import type { Change, EntityType } from './entities.js'
import type { Timestamp } from './hlc.js'

/**
 * Een entiteit zoals hij in de sync-laag leeft: de data plus, per veld, de
 * tijdstempel van de laatste wijziging. Daarmee kan elke client zelfstandig
 * last-writer-wins toepassen zonder de server te vragen.
 */
export interface EntityRecord {
  entityType: EntityType
  id: string
  data: Record<string, unknown>
  fieldTs: Record<string, Timestamp>
}

/**
 * Past één wijziging toe. Per veld wint de hoogste tijdstempel; bij gelijke
 * stempel wint de wijziging die al stond (deterministisch, want de stempel
 * bevat het client-id en is dus uniek per client).
 */
export function applyChange(existing: EntityRecord | undefined, change: Change): EntityRecord {
  const record: EntityRecord = existing
    ? { ...existing, data: { ...existing.data }, fieldTs: { ...existing.fieldTs } }
    : {
        entityType: change.entityType,
        id: change.entityId,
        data: { id: change.entityId },
        fieldTs: {},
      }

  for (const [field, value] of Object.entries(change.fields)) {
    if (field === 'id') continue
    const current = record.fieldTs[field]
    if (current === undefined || change.ts > current) {
      record.data[field] = value
      record.fieldTs[field] = change.ts
    }
  }
  return record
}

/** Past een reeks wijzigingen toe op een verzameling records (gesleuteld op type:id). */
export function applyChanges(
  records: Map<string, EntityRecord>,
  changes: Iterable<Change>,
): Map<string, EntityRecord> {
  for (const change of changes) {
    const key = recordKey(change.entityType, change.entityId)
    records.set(key, applyChange(records.get(key), change))
  }
  return records
}

export function recordKey(entityType: EntityType, id: string): string {
  return `${entityType}:${id}`
}

export function isDeleted(record: EntityRecord): boolean {
  return record.data.deleted === true
}
