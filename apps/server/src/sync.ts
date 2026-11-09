import {
  applyChange,
  type Change,
  Change as ChangeSchema,
  type EntityRecord,
  type EntityType,
  isDeleted,
  recordKey,
  validateChangeFields,
} from '@dingen/core'
import { and, asc, eq, gt, max } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db.js'
import { changes, entities } from './schema.js'

export const PushBody = z.object({ changes: z.array(ChangeSchema).max(1000) })

export interface PushResult {
  /** Hoogste volgnummer na deze push; de client gebruikt dit als cursor. */
  seq: number
  applied: number
  duplicates: number
}

export interface PullResult {
  changes: Change[]
  seq: number
  hasMore: boolean
}

export interface Snapshot {
  entities: EntityRecord[]
  seq: number
}

export class SyncValidationError extends Error {
  constructor(public readonly problems: { changeId: string; issues: string[] }[]) {
    super('Ongeldige wijzigingen')
  }
}

const PULL_LIMIT = 500

export class SyncService {
  constructor(private readonly db: Db) {}

  /**
   * Verwerkt een batch wijzigingen atomair: óf alles wordt toegepast, óf niets.
   * Al bekende wijzigingen (zelfde id) worden stil overgeslagen.
   */
  push(userId: string, incoming: Change[]): PushResult {
    const receivedAt = new Date().toISOString()
    return this.db.transaction((tx) => {
      const touched = new Map<string, EntityRecord>()
      const problems: { changeId: string; issues: string[] }[] = []
      let applied = 0
      let duplicates = 0
      let seq = this.currentSeq(userId)

      for (const change of incoming) {
        const known = tx
          .select({ seq: changes.seq })
          .from(changes)
          .where(and(eq(changes.userId, userId), eq(changes.id, change.id)))
          .get()
        if (known) {
          duplicates += 1
          continue
        }

        const key = recordKey(change.entityType, change.entityId)
        const existing =
          touched.get(key) ?? this.loadRecord(tx, userId, change.entityType, change.entityId)
        const validation = validateChangeFields(change, existing?.data)
        if (!validation.ok) {
          problems.push({ changeId: change.id, issues: validation.issues })
          continue
        }

        const inserted = tx
          .insert(changes)
          .values({
            userId,
            id: change.id,
            clientId: change.clientId,
            entityType: change.entityType,
            entityId: change.entityId,
            fields: change.fields,
            ts: change.ts,
            receivedAt,
          })
          .returning({ seq: changes.seq })
          .get()
        seq = inserted.seq

        const record = applyChange(existing, change)
        touched.set(key, record)
        tx.insert(entities)
          .values({
            userId,
            entityType: record.entityType,
            id: record.id,
            data: record.data,
            fieldTs: record.fieldTs,
            deleted: isDeleted(record),
            updatedSeq: seq,
          })
          .onConflictDoUpdate({
            target: [entities.userId, entities.entityType, entities.id],
            set: {
              data: record.data,
              fieldTs: record.fieldTs,
              deleted: isDeleted(record),
              updatedSeq: seq,
            },
          })
          .run()
        applied += 1
      }

      // Eén ongeldige wijziging maakt de hele batch ongeldig; de transactie rolt terug.
      if (problems.length > 0) {
        throw new SyncValidationError(problems)
      }
      return { seq, applied, duplicates }
    })
  }

  pull(userId: string, since: number, limit = PULL_LIMIT): PullResult {
    const rows = this.db
      .select()
      .from(changes)
      .where(and(eq(changes.userId, userId), gt(changes.seq, since)))
      .orderBy(asc(changes.seq))
      .limit(limit + 1)
      .all()
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page.at(-1)
    return {
      changes: page.map((r) => ({
        id: r.id,
        entityType: r.entityType as EntityType,
        entityId: r.entityId,
        fields: r.fields,
        ts: r.ts,
        clientId: r.clientId,
      })),
      seq: last ? last.seq : since,
      hasMore,
    }
  }

  /** Alle niet-verwijderde entiteiten plus de cursor om vanaf verder te pullen. */
  snapshot(userId: string): Snapshot {
    const rows = this.db
      .select()
      .from(entities)
      .where(and(eq(entities.userId, userId), eq(entities.deleted, false)))
      .all()
    return {
      entities: rows.map((r) => ({
        entityType: r.entityType as EntityType,
        id: r.id,
        data: r.data,
        fieldTs: r.fieldTs,
      })),
      seq: this.currentSeq(userId),
    }
  }

  private currentSeq(userId: string): number {
    const row = this.db
      .select({ seq: max(changes.seq) })
      .from(changes)
      .where(eq(changes.userId, userId))
      .get()
    return row?.seq ?? 0
  }

  private loadRecord(
    db: Db,
    userId: string,
    entityType: EntityType,
    id: string,
  ): EntityRecord | undefined {
    const row = db
      .select()
      .from(entities)
      .where(
        and(eq(entities.userId, userId), eq(entities.entityType, entityType), eq(entities.id, id)),
      )
      .get()
    if (!row) return undefined
    return { entityType, id, data: row.data, fieldTs: row.fieldTs }
  }
}
