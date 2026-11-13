import { createHash } from 'node:crypto'
import {
  type AgentGrant,
  applyChange,
  type Change,
  Change as ChangeSchema,
  type EntityRecord,
  type EntityType,
  entitySchemas,
  isDeleted,
  type MemberId,
  recordKey,
  validateChangeFields,
} from '@dingen/core'
import { and, asc, eq, gt, inArray, max } from 'drizzle-orm'
import { z } from 'zod'
import {
  type Access,
  AgentScopeError,
  canRead,
  checkWrite,
  type Lookup,
  type MemberGrants,
} from './agents/access.js'
import type { Db } from './db.js'
import { changes, entities, type SpaceLevel } from './schema.js'
import {
  inSpacesOf,
  levelAllows,
  memberLevel,
  personalSpaceOf,
  SpaceAccessError,
  spacesOf,
} from './spaces/service.js'

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

/** Een record uit een exportbestand. */
export interface ImportRecord {
  entityType: EntityType
  id: string
  data: Record<string, unknown>
  fieldTs: Record<string, string>
}

export interface ImportCounts {
  created: number
  updated: number
  unchanged: number
}

export interface ImportResult {
  counts: Record<EntityType, ImportCounts>
  seq: number
}

function emptyBucket(): ImportCounts {
  return { created: 0, updated: 0, unchanged: 0 }
}

export function emptyCounts(): Record<EntityType, ImportCounts> {
  const zero = emptyBucket
  return {
    area: zero(),
    project: zero(),
    heading: zero(),
    task: zero(),
    checklistItem: zero(),
    review: zero(),
    tag: zero(),
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Deterministisch ULID-vormig id voor een geïmporteerde wijziging. */
function importChangeId(entityType: string, id: string, ts: string): string {
  const hash = createHash('sha256').update(`${entityType}:${id}:${ts}`).digest()
  let out = ''
  for (let i = 0; i < 26; i++) out += CROCKFORD[(hash[i] ?? 0) & 31]
  return out
}

/** Eén wijziging per verschillende veldtijdstempel, oudste eerst. */
function recordToChanges(record: ImportRecord): Change[] {
  const byTs = new Map<string, Record<string, unknown>>()
  for (const [field, value] of Object.entries(record.data)) {
    if (field === 'id') continue
    const ts = record.fieldTs[field]
    if (!ts) continue
    const group = byTs.get(ts) ?? {}
    group[field] = value
    byTs.set(ts, group)
  }
  return [...byTs.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ts, fields]) => ({
      id: importChangeId(record.entityType, record.id, ts),
      entityType: record.entityType,
      entityId: record.id,
      fields,
      ts,
      clientId: 'import',
    }))
}

export class SyncValidationError extends Error {
  constructor(public readonly problems: { changeId: string; issues: string[] }[]) {
    super('Invalid changes')
  }
}

const PULL_LIMIT = 500

/** Where a stored entity lives: its row key (the maker) and its space. */
interface Located {
  record: EntityRecord
  makerId: string
  spaceId: string
}

/**
 * Per batch: where each entity is (the stored row or the one written in this
 * batch) and what the user may do in which space. New entities go to the
 * user's personal space (moving between spaces comes with plan 23, part 3).
 */
class WriteContext {
  private readonly touched = new Map<string, Located>()
  private readonly levels = new Map<string, SpaceLevel | null>()
  private personal: string | null | undefined

  constructor(
    private readonly tx: Db,
    private readonly userId: string,
    private readonly load: (type: EntityType, id: string) => Located | undefined,
  ) {}

  find(type: EntityType, id: string): Located | undefined {
    return this.touched.get(recordKey(type, id)) ?? this.load(type, id)
  }

  remember(located: Located): void {
    this.touched.set(recordKey(located.record.entityType, located.record.id), located)
  }

  /** The space a write lands in: the entity's own, or the personal space for a new one. */
  target(existing: Located | undefined): { spaceId: string; makerId: string } {
    if (existing) return { spaceId: existing.spaceId, makerId: existing.makerId }
    if (this.personal === undefined) this.personal = personalSpaceOf(this.tx, this.userId)
    if (!this.personal) throw new SpaceAccessError('This account has no personal space')
    return { spaceId: this.personal, makerId: this.userId }
  }

  /** May the user write in this space (edit or manage)? */
  canWrite(spaceId: string): boolean {
    if (!this.levels.has(spaceId)) {
      this.levels.set(spaceId, memberLevel(this.tx, spaceId, this.userId))
    }
    return levelAllows(this.levels.get(spaceId) ?? null, 'edit')
  }
}

export interface PushOptions {
  /** Who pushes, and with which grants; default the owner. */
  access?: Access
  /** Resolves assignees for the check on `assigneeId` (agents only). */
  members?: MemberGrants
  /** Defaults to now; the demo writes changes in the past. */
  receivedAt?: string
}

export class SyncService {
  constructor(private readonly db: Db) {}

  /**
   * Verwerkt een batch wijzigingen atomair: óf alles wordt toegepast, óf niets.
   * Al bekende wijzigingen (zelfde id) worden stil overgeslagen.
   */
  push(userId: string, incoming: Change[], options: PushOptions = {}): PushResult {
    const receivedAt = options.receivedAt ?? new Date().toISOString()
    const access = options.access ?? null
    const actor: MemberId = access?.actor ?? `user:${userId}`
    const members: MemberGrants = options.members ?? (() => undefined)
    return this.db.transaction((tx) => {
      const spaceIds = spacesOf(tx, userId)
      const ctx = new WriteContext(tx, userId, (type, id) => this.locate(tx, spaceIds, type, id))
      const problems: { changeId: string; issues: string[] }[] = []
      const refused: string[] = []
      const lookup: Lookup = (type, id) => ctx.find(type, id)?.record
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

        const located = ctx.find(change.entityType, change.entityId)
        const existing = located?.record
        const validation = validateChangeFields(change, existing?.data)
        if (!validation.ok) {
          problems.push({ changeId: change.id, issues: validation.issues })
          continue
        }

        const record = applyChange(existing, change)
        if (access?.grants) {
          const problem = checkWrite(access, change, existing, record, lookup, members)
          if (problem) {
            refused.push(problem)
            continue
          }
        }
        const target = ctx.target(located)
        if (!ctx.canWrite(target.spaceId)) {
          throw new SpaceAccessError('No write access to the space of this entity')
        }
        ctx.remember({ record, ...target })
        seq = this.store(
          tx,
          userId,
          target,
          located !== undefined,
          change,
          record,
          receivedAt,
          actor,
        )
        applied += 1
      }

      // Eén ongeldige wijziging maakt de hele batch ongeldig; de transactie rolt terug.
      if (problems.length > 0) {
        throw new SyncValidationError(problems)
      }
      if (refused.length > 0) throw new AgentScopeError([...new Set(refused)].join('; '))
      return { seq, applied, duplicates }
    })
  }

  /**
   * Voegt records uit een exportbestand samen met de gegevens van de gebruiker.
   * Elk record wordt één wijziging per verschillende veldtijdstempel in het log,
   * met een deterministisch id: dezelfde import nog eens doen verandert niets.
   * Het samengevoegde resultaat wordt gevalideerd; bij een fout rolt alles terug.
   */
  importRecords(
    userId: string,
    records: ImportRecord[],
    actor: MemberId = `user:${userId}`,
  ): ImportResult {
    const receivedAt = new Date().toISOString()
    return this.db.transaction((tx) => {
      const spaceIds = spacesOf(tx, userId)
      const ctx = new WriteContext(tx, userId, (type, id) => this.locate(tx, spaceIds, type, id))
      const counts = emptyCounts()
      const problems: { changeId: string; issues: string[] }[] = []
      let seq = this.currentSeq(userId)

      for (const incoming of records) {
        const located = ctx.find(incoming.entityType, incoming.id)
        const existing = located?.record
        const target = ctx.target(located)
        let record = existing
        for (const change of recordToChanges(incoming)) {
          const known = tx
            .select({ seq: changes.seq })
            .from(changes)
            .where(and(eq(changes.userId, userId), eq(changes.id, change.id)))
            .get()
          if (known) continue
          const next = applyChange(record, change)
          if (JSON.stringify(next) === JSON.stringify(record)) continue
          if (!ctx.canWrite(target.spaceId)) {
            throw new SpaceAccessError('No write access to the space of this entity')
          }
          record = next
          seq = this.store(tx, userId, target, true, change, next, receivedAt, actor, false)
        }

        const bucket: ImportCounts = counts[incoming.entityType] ?? emptyBucket()
        if (record === existing) {
          bucket.unchanged += 1
          continue
        }
        if (record) {
          const check = entitySchemas[incoming.entityType].strict().safeParse(record.data)
          if (!check.success) {
            problems.push({
              changeId: `${incoming.entityType}:${incoming.id}`,
              issues: check.error.issues.map(
                (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
              ),
            })
          }
          // Het laatst geschreven record is de samengevoegde staat.
          this.writeEntity(tx, target, located !== undefined, record, seq)
          ctx.remember({ record, ...target })
        }
        bucket[existing ? 'updated' : 'created'] += 1
      }

      if (problems.length > 0) throw new SyncValidationError(problems)
      return { counts, seq }
    })
  }

  /**
   * Changes after `since`. With restricted `grants` only the changes of
   * entities the agent can read now; the cursor still covers the whole page.
   */
  pull(
    userId: string,
    since: number,
    limit = PULL_LIMIT,
    grants: AgentGrant[] | null = null,
  ): PullResult {
    const rows = this.db
      .select()
      .from(changes)
      .where(and(inSpacesOf(this.db, changes.spaceId, userId), gt(changes.seq, since)))
      .orderBy(asc(changes.seq))
      .limit(limit + 1)
      .all()
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page.at(-1)
    const readable = this.readableFilter(userId, grants)
    return {
      changes: page
        .filter((r) => readable(r.entityType as EntityType, r.entityId))
        .map((r) => ({
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

  /**
   * Alle niet-verwijderde entiteiten plus de cursor om vanaf verder te pullen.
   * With restricted `grants` only what the agent can read.
   */
  snapshot(userId: string, grants: AgentGrant[] | null = null): Snapshot {
    const rows = this.db
      .select()
      .from(entities)
      .where(and(inSpacesOf(this.db, entities.spaceId, userId), eq(entities.deleted, false)))
      .all()
    const records: EntityRecord[] = rows.map((r) => ({
      entityType: r.entityType as EntityType,
      id: r.id,
      data: r.data,
      fieldTs: r.fieldTs,
    }))
    const seq = this.currentSeq(userId)
    if (!restricted(grants)) return { entities: records, seq }
    const byKey = new Map(records.map((r) => [recordKey(r.entityType, r.id), r]))
    const lookup: Lookup = (type, id) => byKey.get(recordKey(type, id))
    return { entities: records.filter((r) => canRead(grants, r, lookup)), seq }
  }

  /** All records of the user (deleted ones too), for access checks outside a push. */
  lookupFor(userId: string): Lookup {
    const rows = this.db
      .select()
      .from(entities)
      .where(inSpacesOf(this.db, entities.spaceId, userId))
      .all()
    const byKey = new Map<string, EntityRecord>(
      rows.map((r) => [
        recordKey(r.entityType as EntityType, r.id),
        { entityType: r.entityType as EntityType, id: r.id, data: r.data, fieldTs: r.fieldTs },
      ]),
    )
    return (type, id) => byKey.get(recordKey(type, id))
  }

  private readableFilter(
    userId: string,
    grants: AgentGrant[] | null,
  ): (type: EntityType, id: string) => boolean {
    if (!restricted(grants)) return () => true
    const lookup = this.lookupFor(userId)
    return (type, id) => {
      const record = lookup(type, id)
      return record !== undefined && canRead(grants, record, lookup)
    }
  }

  /** Schrijft één wijziging in het log en werkt de entiteit bij; geeft het nieuwe volgnummer. */
  private store(
    tx: Db,
    userId: string,
    target: { spaceId: string; makerId: string },
    exists: boolean,
    change: Change,
    record: EntityRecord,
    receivedAt: string,
    actor: MemberId,
    writeEntity = true,
  ): number {
    const inserted = tx
      .insert(changes)
      .values({
        userId,
        spaceId: target.spaceId,
        id: change.id,
        clientId: change.clientId,
        entityType: change.entityType,
        entityId: change.entityId,
        fields: change.fields,
        ts: change.ts,
        receivedAt,
        actor,
      })
      .returning({ seq: changes.seq })
      .get()
    if (writeEntity) this.writeEntity(tx, target, exists, record, inserted.seq)
    return inserted.seq
  }

  /**
   * Writes the state of an entity. A known one is updated in place (its row
   * key is the maker), a new one is inserted in the target space. `exists`
   * may be true for an entity first written earlier in the same batch.
   */
  private writeEntity(
    tx: Db,
    target: { spaceId: string; makerId: string },
    exists: boolean,
    record: EntityRecord,
    seq: number,
  ): void {
    const state = {
      data: record.data,
      fieldTs: record.fieldTs,
      deleted: isDeleted(record),
      updatedSeq: seq,
    }
    const key = and(
      eq(entities.userId, target.makerId),
      eq(entities.entityType, record.entityType),
      eq(entities.id, record.id),
    )
    if (exists && tx.update(entities).set(state).where(key).run().changes > 0) return
    tx.insert(entities)
      .values({
        userId: target.makerId,
        spaceId: target.spaceId,
        entityType: record.entityType,
        id: record.id,
        ...state,
      })
      .run()
  }

  /** Heeft de gebruiker al (levende) gegevens? */
  hasEntities(userId: string): boolean {
    return !!this.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(inSpacesOf(this.db, entities.spaceId, userId), eq(entities.deleted, false)))
      .limit(1)
      .get()
  }

  private currentSeq(userId: string): number {
    const row = this.db
      .select({ seq: max(changes.seq) })
      .from(changes)
      .where(inSpacesOf(this.db, changes.spaceId, userId))
      .get()
    return row?.seq ?? 0
  }

  /** The stored entity with this type and id in one of these spaces (the user's). */
  private locate(
    db: Db,
    spaceIds: string[],
    entityType: EntityType,
    id: string,
  ): Located | undefined {
    const row = db
      .select()
      .from(entities)
      .where(
        and(
          inArray(entities.spaceId, spaceIds),
          eq(entities.entityType, entityType),
          eq(entities.id, id),
        ),
      )
      .get()
    if (!row) return undefined
    return {
      record: { entityType, id, data: row.data, fieldTs: row.fieldTs },
      makerId: row.userId,
      spaceId: row.spaceId,
    }
  }
}

/** Grants that limit what can be read: anything but the owner or an `all` grant. */
function restricted(grants: AgentGrant[] | null): grants is AgentGrant[] {
  return grants !== null && !grants.some((g) => g.scope === 'all')
}
