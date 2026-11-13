import { createHash } from 'node:crypto'
import {
  type AgentGrant,
  applyChange,
  type Change,
  Change as ChangeSchema,
  type EntityKey,
  type EntityRecord,
  type EntityType,
  entitySchemas,
  isDeleted,
  type MemberId,
  type Placed,
  type PullResponse,
  type PullSpace,
  type PushResponse,
  recordKey,
  type SnapshotResponse,
  SPACE_FIELD,
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
  hasAll,
  type Lookup,
  type MemberGrants,
} from './agents/access.js'
import type { Db } from './db.js'
import { changes, entities, type SpaceLevel } from './schema.js'
import {
  after,
  arrivalAsChanges,
  childrenOf,
  containerRefs,
  derivedId,
  isMoveRow,
  latest,
  MOVABLE,
  SERVER_CLIENT_ID,
} from './spaces/move.js'
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
 * batch) and what the user may do in which space.
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

  /**
   * The space a write lands in: the entity's own; for a new one the space the
   * change asks for, else the space of its container (project, area, heading
   * or task), else the personal space.
   */
  target(
    existing: Located | undefined,
    record?: EntityRecord,
    requested?: string,
  ): { spaceId: string; makerId: string } {
    if (existing) return { spaceId: existing.spaceId, makerId: existing.makerId }
    if (requested) return { spaceId: requested, makerId: this.userId }
    for (const [field, type] of record ? containerRefs(record.entityType) : []) {
      const id = record?.data[field]
      const container = typeof id === 'string' ? this.find(type, id) : undefined
      if (container) return { spaceId: container.spaceId, makerId: this.userId }
    }
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

/** What one push wrote: rows per space, spaces with moves, where entities landed. */
class Written {
  readonly perSpace = new Map<string, { count: number; seq: number }>()
  /** Spaces where the server wrote rows along with a move: never moved past by the cursor. */
  readonly moved = new Set<string>()
  readonly placed: Placed[] = []

  row(spaceId: string, seq: number): void {
    const inSpace = this.perSpace.get(spaceId) ?? { count: 0, seq: 0 }
    this.perSpace.set(spaceId, { count: inSpace.count + 1, seq })
  }
}

/** Per push and target space: tag ids by lower-case title. */
type TagIndex = Map<string, Map<string, string>>

/** What a move writes with: when, by whom, and where it keeps track. */
interface MoveOut {
  receivedAt: string
  actor: MemberId
  written: Written
  tagIndex: TagIndex
}

/** Why this entity cannot be moved on its own, or null. */
function moveIssue(record: EntityRecord): string | null {
  if (!MOVABLE.includes(record.entityType)) {
    return `spaceId: a ${record.entityType} cannot move on its own; move what it belongs to`
  }
  if (isDeleted(record)) return 'spaceId: a deleted entity cannot move'
  return null
}

/** A new entity in space `spaceId` may not sit in a container of another space. */
function crossSpaceRef(ctx: WriteContext, record: EntityRecord, spaceId: string): string | null {
  for (const [field, type] of containerRefs(record.entityType)) {
    const id = record.data[field]
    const container = typeof id === 'string' ? ctx.find(type, id) : undefined
    if (container && container.spaceId !== spaceId) return `${field}: is in another space`
  }
  return null
}

/** A tag name as it is compared: trimmed, in lower case; null for no name. */
function nameOf(title: unknown): string | null {
  if (typeof title !== 'string') return null
  const name = title.trim().toLocaleLowerCase()
  return name === '' ? null : name
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
      const out: MoveOut = { receivedAt, actor, written: new Written(), tagIndex: new Map() }
      const { written } = out

      for (const pushed of incoming) {
        const known = tx
          .select({ seq: changes.seq })
          .from(changes)
          .where(and(eq(changes.userId, userId), eq(changes.id, pushed.id)))
          .get()
        if (known) {
          duplicates += 1
          continue
        }

        // `spaceId` names a space (plan 23, part 3); it is not an entity field.
        const requested = pushed.fields[SPACE_FIELD]
        if (requested !== undefined && (typeof requested !== 'string' || requested === '')) {
          problems.push({ changeId: pushed.id, issues: ['spaceId: must be a space id'] })
          continue
        }
        const { [SPACE_FIELD]: _space, ...fields } = pushed.fields
        const change: Change = requested === undefined ? pushed : { ...pushed, fields }

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

        if (located && requested !== undefined && requested !== located.spaceId) {
          const issue = moveIssue(record)
          if (issue) {
            problems.push({ changeId: change.id, issues: [issue] })
            continue
          }
          if (access?.grants && !hasAll(access.grants, 'edit')) {
            refused.push('Moving between spaces needs edit on everything')
            continue
          }
          if (!ctx.canWrite(located.spaceId) || !ctx.canWrite(requested)) {
            throw new SpaceAccessError('Moving needs edit in both spaces')
          }
          seq = this.move(tx, ctx, userId, { located, record, change, to: requested }, out)
          applied += 1
          continue
        }

        const target = ctx.target(located, record, requested)
        if (!located && requested !== undefined) {
          const issue = crossSpaceRef(ctx, record, requested)
          if (issue) {
            problems.push({ changeId: change.id, issues: [issue] })
            continue
          }
        }
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
        written.row(target.spaceId, seq)
        if (!located) {
          written.placed.push({
            entityType: change.entityType,
            id: change.entityId,
            spaceId: target.spaceId,
          })
        }
        applied += 1
      }

      // Eén ongeldige wijziging maakt de hele batch ongeldig; de transactie rolt terug.
      if (problems.length > 0) {
        throw new SyncValidationError(problems)
      }
      if (refused.length > 0) throw new AgentScopeError([...new Set(refused)].join('; '))
      const result: PushResult = { seq, applied, duplicates }
      if (options.cursor) result.cursor = this.advance(tx, options.cursor, written)
      if (written.placed.length > 0) result.placed = written.placed
      return result
    })
  }

  /**
   * Moves an entity and its children to another space (plan 23, decision 7);
   * see spaces/move.ts for the rows it writes. References to containers that
   * stay behind are cleared, and tags become the tags of the new space with
   * the same name (made when missing). Entities keep their ids. Returns the
   * last `seq`.
   */
  private move(
    tx: Db,
    ctx: WriteContext,
    userId: string,
    what: { located: Located; record: EntityRecord; change: Change; to: string },
    out: MoveOut,
  ): number {
    const { located, record: root, change, to } = what
    const from = located.spaceId
    const live = tx
      .select()
      .from(entities)
      .where(and(eq(entities.spaceId, from), eq(entities.deleted, false)))
      .all()
    const makers = new Map(live.map((r) => [recordKey(r.entityType as EntityType, r.id), r.userId]))
    const children = childrenOf(
      root,
      live.map((r) => ({
        entityType: r.entityType as EntityType,
        id: r.id,
        data: r.data,
        fieldTs: r.fieldTs,
      })),
    )
    const moving = new Set([root, ...children].map((r) => recordKey(r.entityType, r.id)))
    const staysBehind = (type: EntityType, id: string) =>
      !moving.has(recordKey(type, id)) && ctx.find(type, id)?.spaceId !== to

    let seq = 0
    const insert = (spaceId: string, row: Change) => {
      seq = this.insertChange(tx, userId, spaceId, row, out.receivedAt, out.actor)
      out.written.row(spaceId, seq)
    }
    for (const rec of [root, ...children]) {
      const key = recordKey(rec.entityType, rec.id)
      const isRoot = rec === root
      const base = { entityType: rec.entityType, entityId: rec.id }
      insert(from, {
        ...base,
        id: derivedId(`${change.id}:leave:${key}`),
        fields: { [SPACE_FIELD]: to },
        ts: change.ts,
        clientId: SERVER_CLIENT_ID,
      })
      insert(to, {
        ...base,
        id: isRoot ? change.id : derivedId(`${change.id}:arrive:${key}`),
        fields: { ...(isRoot ? change.fields : {}), [SPACE_FIELD]: to },
        ts: change.ts,
        clientId: isRoot ? change.clientId : SERVER_CLIENT_ID,
      })

      // What changes with the move: containers that stay behind, and tags.
      const fix: Record<string, unknown> = {}
      for (const [field, type] of containerRefs(rec.entityType)) {
        const id = rec.data[field]
        if (typeof id === 'string' && staysBehind(type, id)) fix[field] = null
      }
      const tagIds = rec.data.tagIds
      if (Array.isArray(tagIds) && tagIds.length > 0) {
        const swapped = this.swapTags(tx, ctx, userId, tagIds as string[], to, change, out)
        if (JSON.stringify(swapped) !== JSON.stringify(tagIds)) fix.tagIds = swapped
      }
      let moved = rec
      if (Object.keys(fix).length > 0) {
        // Just after everything the entity had, so the fix wins everywhere.
        const ts = after(latest(change.ts, ...Object.values(rec.fieldTs)))
        insert(to, {
          ...base,
          id: derivedId(`${change.id}:fix:${key}`),
          fields: fix,
          ts,
          clientId: SERVER_CLIENT_ID,
        })
        moved = {
          ...rec,
          data: { ...rec.data, ...fix },
          fieldTs: { ...rec.fieldTs, ...Object.fromEntries(Object.keys(fix).map((f) => [f, ts])) },
        }
      }
      const makerId = isRoot ? located.makerId : (makers.get(key) ?? userId)
      tx.update(entities)
        .set({
          spaceId: to,
          data: moved.data,
          fieldTs: moved.fieldTs,
          deleted: isDeleted(moved),
          updatedSeq: seq,
        })
        .where(
          and(
            eq(entities.userId, makerId),
            eq(entities.entityType, rec.entityType),
            eq(entities.id, rec.id),
          ),
        )
        .run()
      ctx.remember({ record: moved, makerId, spaceId: to })
      out.written.placed.push({ entityType: rec.entityType, id: rec.id, spaceId: to })
    }
    out.written.moved.add(from)
    out.written.moved.add(to)
    return seq
  }

  /**
   * The tags of space `to` for these tag ids (decisions 4 and 7): a tag of
   * `to` stays, any other becomes the live tag of `to` with the same name
   * (compared trimmed and in lower case), made there when there is none.
   * Unknown and deleted tags fall off.
   */
  private swapTags(
    tx: Db,
    ctx: WriteContext,
    userId: string,
    tagIds: string[],
    to: string,
    change: Change,
    out: MoveOut,
  ): string[] {
    let index = out.tagIndex.get(to)
    if (!index) {
      index = new Map()
      const rows = tx
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.spaceId, to),
            eq(entities.entityType, 'tag'),
            eq(entities.deleted, false),
          ),
        )
        .all()
      for (const row of rows) {
        const name = nameOf(row.data.title)
        if (name !== null && !index.has(name)) index.set(name, row.id)
      }
      out.tagIndex.set(to, index)
    }
    const result: string[] = []
    for (const tagId of tagIds) {
      const tag = ctx.find('tag', tagId)
      if (!tag || isDeleted(tag.record)) continue
      let id: string | undefined = tagId
      if (tag.spaceId !== to) {
        const name = nameOf(tag.record.data.title)
        if (name === null) continue
        id = index.get(name)
        if (!id) {
          id = this.createTag(tx, ctx, userId, to, tag.record, change, out)
          index.set(name, id)
        }
      }
      if (!result.includes(id)) result.push(id)
    }
    return result
  }

  /** A copy of tag `like` in space `to`, for a moved task or project; returns its id. */
  private createTag(
    tx: Db,
    ctx: WriteContext,
    userId: string,
    to: string,
    like: EntityRecord,
    change: Change,
    out: MoveOut,
  ): string {
    const id = derivedId(`${change.id}:tag:${to}:${like.id}`)
    const row: Change = {
      id: derivedId(`${change.id}:tag-change:${to}:${like.id}`),
      entityType: 'tag',
      entityId: id,
      fields: {
        title: like.data.title,
        parentId: null,
        order: typeof like.data.order === 'string' ? like.data.order : 'a',
        createdAt: out.receivedAt,
        deleted: false,
      },
      ts: after(change.ts),
      clientId: SERVER_CLIENT_ID,
    }
    const record = applyChange(undefined, row)
    const target = { spaceId: to, makerId: userId }
    const seq = this.store(tx, userId, target, false, row, record, out.receivedAt, out.actor)
    out.written.row(to, seq)
    out.written.moved.add(to)
    out.written.placed.push({ entityType: 'tag', id, spaceId: to })
    ctx.remember({ record, ...target })
    return id
  }

  /**
   * The spaces where nothing but this push happened after the client's
   * cursor, with the cursor moved past it. The push runs in one transaction,
   * so nothing can come after it; anything between the cursor and the push
   * (someone else's change) means the client still has to pull that space.
   */
  private advance(tx: Db, cursor: SpaceCursor, written: Written): SpaceCursor {
    const out: SpaceCursor = {}
    for (const [spaceId, mine] of written.perSpace) {
      const since = cursor[spaceId]
      if (since === undefined || written.moved.has(spaceId)) continue
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
    const moves = this.moveView(userId, grants)
    const out: Change[] = []
    for (const row of page) {
      if (!isMoveRow(row.fields)) {
        if (readable(row.entityType as EntityType, row.entityId)) out.push(toChange(row))
        continue
      }
      // Protocol 1 knows no spaces: leaving your sight is a deletion, arriving the whole record.
      const seen = moves(row)
      if (seen === 'left') out.push({ ...toChange(row), fields: { deleted: true } })
      else if (seen) out.push(...arrivalAsChanges(row, seen))
    }
    return { changes: out, seq: last ? last.seq : since, hasMore }
  }

  /**
   * How move rows (see spaces/move.ts) look to one viewer: an arrival in the
   * space where the entity is now, when the viewer can see it there, gives
   * the current record; a leave gives `'left'` when the viewer cannot see the
   * entity anywhere now (another space, or outside an agent's grants); every
   * other move row gives nothing, since the entity's current space tells.
   */
  private moveView(
    userId: string,
    grants: AgentGrant[] | null,
  ): (row: typeof changes.$inferSelect) => EntityRecord | 'left' | null {
    let spaceIds: string[] | undefined
    let lookup: Lookup | undefined
    const now = new Map<string, Located | null>()
    return (row) => {
      const type = row.entityType as EntityType
      const key = recordKey(type, row.entityId)
      if (!now.has(key)) {
        spaceIds ??= spacesOf(this.db, userId)
        const found = this.locate(this.db, spaceIds, type, row.entityId)
        let visible = found !== undefined
        if (found && restricted(grants)) {
          lookup ??= this.lookupFor(userId)
          visible = canRead(grants, found.record, lookup)
        }
        now.set(key, visible && found ? found : null)
      }
      const current = now.get(key) ?? null
      const arrival = row.fields.spaceId === row.spaceId
      if (!arrival) return current ? null : 'left'
      return current && current.spaceId === row.spaceId ? current.record : null
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
    const moves = this.moveView(userId, grants)
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
      const plain: Change[] = []
      const arrived = new Map<string, EntityRecord>()
      const left = new Map<string, EntityKey>()
      for (const row of page) {
        const type = row.entityType as EntityType
        if (!isMoveRow(row.fields)) {
          if (readable(type, row.entityId)) plain.push(toChange(row))
          continue
        }
        const seen = moves(row)
        const key = recordKey(type, row.entityId)
        if (seen === 'left') left.set(key, { entityType: type, id: row.entityId })
        else if (seen) arrived.set(key, seen)
      }
      out.push({
        ...space,
        seq: page.at(-1)?.seq ?? since,
        changes: plain,
        ...(arrived.size > 0 ? { arrived: [...arrived.values()] } : {}),
        ...(left.size > 0 ? { left: [...left.values()] } : {}),
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
    const seq = this.insertChange(tx, userId, target.spaceId, change, receivedAt, actor)
    if (writeEntity) this.writeEntity(tx, target, exists, record, seq)
    return seq
  }

  /** Writes one row in the log, in `spaceId`; returns its `seq`. */
  private insertChange(
    tx: Db,
    userId: string,
    spaceId: string,
    change: Change,
    receivedAt: string,
    actor: MemberId,
  ): number {
    return tx
      .insert(changes)
      .values({
        userId,
        spaceId,
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
      .get().seq
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
