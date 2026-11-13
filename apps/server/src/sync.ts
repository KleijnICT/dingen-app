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
  type PullResponse,
  type PullSpace,
  type PushResponse,
  recordKey,
  type SnapshotResponse,
  type SpaceCursor,
  SpaceCursorSchema,
  type SpacedRecord,
  SYNC_PROTOCOL,
  validateChangeFields,
} from '@dingen/core'
import { and, asc, count, eq, gt, inArray, max } from 'drizzle-orm'
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
  memberSpaces,
  personalSpaceOf,
  SpaceAccessError,
  spacesOf,
} from './spaces/service.js'

export const PushBody = z.object({
  changes: z.array(ChangeSchema).max(1000),
  /** Protocol 2: the client's cursor, so the answer can move it past its own changes. */
  cursor: SpaceCursorSchema.optional(),
})

export type PushResult = PushResponse

/** Protocol 1 pull (`since=<seq>`): one cursor over all the user's spaces. */
export interface PullResult {
  changes: Change[]
  seq: number
  hasMore: boolean
}

export type Snapshot = SnapshotResponse

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
  /** The client's cursor per space (protocol 2); see `PushResponse.cursor`. */
  cursor?: SpaceCursor | undefined
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
      /** Per space: how many changes this push wrote and the highest seq. */
      const written = new Map<string, { count: number; seq: number }>()

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
        const inSpace = written.get(target.spaceId) ?? { count: 0, seq: 0 }
        written.set(target.spaceId, { count: inSpace.count + 1, seq })
        applied += 1
      }

      // Eén ongeldige wijziging maakt de hele batch ongeldig; de transactie rolt terug.
      if (problems.length > 0) {
        throw new SyncValidationError(problems)
      }
      if (refused.length > 0) throw new AgentScopeError([...new Set(refused)].join('; '))
      if (!options.cursor) return { seq, applied, duplicates }
      return { seq, applied, duplicates, cursor: this.advance(tx, options.cursor, written) }
    })
  }

  /**
   * The spaces where nothing but this push happened after the client's
   * cursor, with the cursor moved past it. The push runs in one transaction,
   * so nothing can come after it; anything between the cursor and the push
   * (someone else's change) means the client still has to pull that space.
   */
  private advance(
    tx: Db,
    cursor: SpaceCursor,
    written: Map<string, { count: number; seq: number }>,
  ): SpaceCursor {
    const out: SpaceCursor = {}
    for (const [spaceId, mine] of written) {
      const since = cursor[spaceId]
      if (since === undefined) continue
      const after = tx
        .select({ n: count() })
        .from(changes)
        .where(and(eq(changes.spaceId, spaceId), gt(changes.seq, since)))
        .get()
      if ((after?.n ?? 0) === mine.count) out[spaceId] = mine.seq
    }
    return out
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
   * Protocol 1: changes after `since` over all the user's spaces, in global
   * order. Kept for clients from before protocol 2 (a cached web app, an
   * older MCP plugin). With restricted `grants` only the changes of entities
   * the agent can read now; the cursor still covers the whole page.
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
      changes: page.filter((r) => readable(r.entityType as EntityType, r.entityId)).map(toChange),
      seq: last ? last.seq : since,
      hasMore,
    }
  }

  /**
   * Protocol 2: changes per space after the client's cursor for that space.
   * A space missing from the cursor comes as a snapshot; a space in the cursor
   * the user is no longer a member of is listed in `removed`. A number instead
   * of a cursor (a stored protocol 1 cursor) counts for every space, without
   * snapshots. At most `limit` changes per answer over all spaces.
   */
  pullSpaces(
    userId: string,
    cursor: SpaceCursor | number,
    limit = PULL_LIMIT,
    grants: AgentGrant[] | null = null,
  ): PullResponse {
    const mine = memberSpaces(this.db, userId)
    const removed =
      typeof cursor === 'number'
        ? []
        : Object.keys(cursor).filter((id) => !mine.some((s) => s.id === id))
    const readable = this.readableFilter(userId, grants)
    let budget = limit
    const out: PullSpace[] = []
    for (const space of mine) {
      const since = typeof cursor === 'number' ? cursor : cursor[space.id]
      if (since === undefined) {
        const entities = this.liveEntities(userId, [space.id], grants).map(withoutSpace)
        const seq = this.spaceSeqs([space.id])[space.id] ?? 0
        out.push({ ...space, seq, changes: [], entities, hasMore: false })
        continue
      }
      // The index (space_id, seq) gives the rows in order: no sort over all spaces.
      const rows =
        budget === 0
          ? []
          : this.db
              .select()
              .from(changes)
              .where(and(eq(changes.spaceId, space.id), gt(changes.seq, since)))
              .orderBy(asc(changes.seq))
              .limit(budget + 1)
              .all()
      const hasMore = budget === 0 ? this.hasChangesAfter(space.id, since) : rows.length > budget
      const page = rows.length > budget ? rows.slice(0, budget) : rows
      budget -= page.length
      out.push({
        ...space,
        seq: page.at(-1)?.seq ?? since,
        changes: page.filter((r) => readable(r.entityType as EntityType, r.entityId)).map(toChange),
        hasMore,
      })
    }
    return {
      protocol: SYNC_PROTOCOL,
      spaces: out,
      removed,
      cursor: Object.fromEntries(out.map((s) => [s.id, s.seq])),
      hasMore: out.some((s) => s.hasMore),
    }
  }

  /**
   * Alle niet-verwijderde entiteiten plus de cursor om vanaf verder te pullen:
   * per space (protocol 2) and over all spaces (`seq`, protocol 1). With
   * `spaceId` only that space (none when the user is not a member). With
   * restricted `grants` only what the agent can read.
   */
  snapshot(
    userId: string,
    grants: AgentGrant[] | null = null,
    spaceId: string | null = null,
  ): Snapshot {
    const all = memberSpaces(this.db, userId)
    const mine = spaceId === null ? all : all.filter((s) => s.id === spaceId)
    const ids = mine.map((s) => s.id)
    const cursor = this.spaceSeqs(ids)
    return {
      protocol: SYNC_PROTOCOL,
      entities: this.liveEntities(userId, ids, grants),
      spaces: mine,
      cursor,
      seq: Math.max(0, ...Object.values(cursor)),
    }
  }

  /** The live entities in these spaces; with restricted `grants` only what the agent can read. */
  private liveEntities(
    userId: string,
    spaceIds: string[],
    grants: AgentGrant[] | null,
  ): SpacedRecord[] {
    if (spaceIds.length === 0) return []
    const records: SpacedRecord[] = this.db
      .select()
      .from(entities)
      .where(and(inArray(entities.spaceId, spaceIds), eq(entities.deleted, false)))
      .all()
      .map((r) => ({
        entityType: r.entityType as EntityType,
        id: r.id,
        data: r.data,
        fieldTs: r.fieldTs,
        spaceId: r.spaceId,
      }))
    if (!restricted(grants)) return records
    const lookup = this.lookupFor(userId)
    return records.filter((r) => canRead(grants, r, lookup))
  }

  /** The highest seq per space (0 for a space without changes). */
  private spaceSeqs(spaceIds: string[]): SpaceCursor {
    const out: SpaceCursor = Object.fromEntries(spaceIds.map((id) => [id, 0]))
    if (spaceIds.length === 0) return out
    const rows = this.db
      .select({ spaceId: changes.spaceId, seq: max(changes.seq) })
      .from(changes)
      .where(inArray(changes.spaceId, spaceIds))
      .groupBy(changes.spaceId)
      .all()
    for (const row of rows) out[row.spaceId] = row.seq ?? 0
    return out
  }

  private hasChangesAfter(spaceId: string, since: number): boolean {
    return !!this.db
      .select({ seq: changes.seq })
      .from(changes)
      .where(and(eq(changes.spaceId, spaceId), gt(changes.seq, since)))
      .limit(1)
      .get()
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

function toChange(r: typeof changes.$inferSelect): Change {
  return {
    id: r.id,
    entityType: r.entityType as EntityType,
    entityId: r.entityId,
    fields: r.fields,
    ts: r.ts,
    clientId: r.clientId,
  }
}

function withoutSpace({ spaceId: _space, ...record }: SpacedRecord): EntityRecord {
  return record
}

/** Grants that limit what can be read: anything but the owner or an `all` grant. */
function restricted(grants: AgentGrant[] | null): grants is AgentGrant[] {
  return grants !== null && !grants.some((g) => g.scope === 'all')
}
