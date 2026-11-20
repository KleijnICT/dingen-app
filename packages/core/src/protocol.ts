import { z } from 'zod'
import { Change, EntityType } from './entities.js'
import { TIMESTAMP_PATTERN } from './hlc.js'

/**
 * The sync protocol between clients and the server.
 *
 * A cursor per space (`pull?cursor={"<spaceId>":<seq>}`), so a space that is
 * shared with you later starts with a snapshot of that space and a space you
 * leave is reported so you drop its data. `seq` stays one counter for the
 * whole server; a cursor per space is the highest `seq` of that space the
 * client has seen.
 *
 * Moving between spaces (plan 23, part 3): a change with the field `spaceId`
 * (see `SPACE_FIELD`) puts a new entity in that space, or moves an existing
 * one there with its children. A pull reports a move per space as `arrived`
 * (the whole entity, now in this space) and `left` (gone out of your sight:
 * drop it).
 *
 * History: protocol 1 had one cursor for the whole account (`pull?since=`),
 * protocol 2 added the cursor per space, protocol 3 (plan 25) gave tasks
 * `daypart` and `duration` instead of `evening` and `time`. Protocol 4
 * (plan 33, 1.0.0-beta.1) dropped the support for 1 to 3, the `review`
 * entity type, and the `seq` over all spaces in snapshot and push answers.
 *
 * From 1.0.0-beta.1 until 2.0 the protocol only grows: new optional fields
 * with a default, new entity types that older clients ignore. Nothing is
 * renamed, removed or made stricter. The contract test in
 * apps/server/test/contract pins the shapes below; see its README.
 */
export const SYNC_PROTOCOL = 4

/**
 * The oldest protocol the server accepts. A sync request that names an older
 * one, or none, gets HTTP 426 with a `ClientOutdatedBody`.
 */
export const MIN_CLIENT_PROTOCOL = 4

/** The request header in which a client names the sync protocol it speaks. Required. */
export const PROTOCOL_HEADER = 'x-dingen-protocol'

/** The protocol a request speaks, from its `PROTOCOL_HEADER` value; 0 when it names none. */
export function requestProtocol(header: string | null | undefined): number {
  const value = Number(header)
  return header && Number.isInteger(value) && value >= 1 ? value : 0
}

/** The `error` of a sync request from a client that is too old. */
export const CLIENT_OUTDATED = 'client_outdated'

/** HTTP status for `CLIENT_OUTDATED`: 426 Upgrade Required. */
export const CLIENT_OUTDATED_STATUS = 426

export const ClientOutdatedBodySchema = z.object({
  error: z.literal(CLIENT_OUTDATED),
  /** The protocol the server speaks. */
  protocol: z.number().int(),
  /** The oldest protocol it accepts. */
  minProtocol: z.number().int(),
  /** For people: what to do. */
  message: z.string(),
})
export type ClientOutdatedBody = z.infer<typeof ClientOutdatedBodySchema>

/** The answer to a sync request from a client that speaks `protocol` (0: names none). */
export function clientOutdatedBody(protocol: number): ClientOutdatedBody {
  const spoken = protocol > 0 ? `sync protocol ${protocol}` : 'an old sync protocol'
  return {
    error: CLIENT_OUTDATED,
    protocol: SYNC_PROTOCOL,
    minProtocol: MIN_CLIENT_PROTOCOL,
    message: `This app is out of date: it speaks ${spoken} and this Dingen server needs protocol ${MIN_CLIENT_PROTOCOL} or newer. Reload the web app, or update the Dingen plugin.`,
  }
}

/** A client got `CLIENT_OUTDATED`: it must be updated before it can sync. */
export class ClientOutdatedError extends Error {
  readonly code = CLIENT_OUTDATED
  constructor(message = clientOutdatedBody(0).message) {
    super(message)
    this.name = 'ClientOutdatedError'
  }
}

/**
 * The change field that names the space for an entity: on a new entity the
 * space it goes into (default: the space of its project, area, heading or
 * task, else the personal space); on an existing area, project or task a move
 * to that space. It is not an entity field: it never shows up in `data`.
 */
export const SPACE_FIELD = 'spaceId'

const SpaceId = z.string().min(1).max(64)

/** The highest `seq` seen per space id. */
export const SpaceCursorSchema = z.record(SpaceId, z.number().int().min(0))
export type SpaceCursor = Record<string, number>

/** The `cursor` query parameter of a pull: a JSON object per space. Null when it cannot be read. */
export function parseCursorParam(raw: string): SpaceCursor | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = SpaceCursorSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const SpaceKindSchema = z.enum(['personal', 'shared'])
export type SpaceKind = z.infer<typeof SpaceKindSchema>
export const SpaceLevelSchema = z.enum(['read', 'edit', 'manage'])
export type SpaceLevel = z.infer<typeof SpaceLevelSchema>

/** A space the user is a member of. */
export const SpaceInfoSchema = z.object({
  id: SpaceId,
  kind: SpaceKindSchema,
  level: SpaceLevelSchema,
})
export type SpaceInfo = z.infer<typeof SpaceInfoSchema>

/** An entity as it lives in the sync layer: its data and a stamp per field (`EntityRecord`). */
export const EntityRecordSchema = z.object({
  entityType: EntityType,
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
  fieldTs: z.record(z.string(), z.string().regex(TIMESTAMP_PATTERN)),
})

/** A record with the space it lives in; what snapshots deliver. */
export const SpacedRecordSchema = EntityRecordSchema.extend({ spaceId: SpaceId })
export type SpacedRecord = z.infer<typeof SpacedRecordSchema>

/** An entity by type and id. */
export const EntityKeySchema = z.object({ entityType: EntityType, id: z.string() })
export type EntityKey = z.infer<typeof EntityKeySchema>

/** One space in a pull. */
export const PullSpaceSchema = SpaceInfoSchema.extend({
  /** The cursor for this space after applying this answer. */
  seq: z.number().int().min(0),
  /** Changes after the client's cursor for this space, oldest first. */
  changes: z.array(Change),
  /**
   * Only for a space the client did not know (absent from its cursor): every
   * live entity of the space. The client replaces what it had for this space.
   * `changes` is then empty.
   */
  entities: z.array(EntityRecordSchema).optional(),
  /**
   * Entities that moved into this space (or into your reach) within this
   * answer's range of changes: the whole current record. Put it as it is
   * (replacing what you had, also in another space) and note this space as
   * its space. Apply after `changes`.
   */
  arrived: z.array(EntityRecordSchema).optional(),
  /**
   * Entities that moved out of this space to where you cannot see them (a
   * space you are not in, or outside an agent's grants): drop them, as if
   * deleted. Apply after `changes`. An entity that moved to another space of
   * yours is not listed here; it comes as `arrived` in that space.
   */
  left: z.array(EntityKeySchema).optional(),
  /** This space has more changes than fitted in this answer. */
  hasMore: z.boolean(),
  /**
   * The client's cursor for this space was ahead of the server: the server
   * was restored from a back-up (plan 24) and lost changes the client has
   * seen; or the cursor was older than the server's change log, which keeps
   * changes for a year. `entities` then holds the whole space, as for a space
   * the client did not know: replace what you had for it (keeping unsent changes).
   */
  resync: z.literal(true).optional(),
})
export type PullSpace = z.infer<typeof PullSpaceSchema>

/** `GET /api/sync/pull?cursor=<URL-encoded JSON SpaceCursor>`. */
export const PullResponseSchema = z.object({
  protocol: z.number().int(),
  spaces: z.array(PullSpaceSchema),
  /** Spaces in the client's cursor the user is no longer a member of: drop their data. */
  removed: z.array(z.string()),
  /** The full new cursor: one entry per space of the user. */
  cursor: SpaceCursorSchema,
  /** Pull again with the new cursor: some space has more. */
  hasMore: z.boolean(),
})
export type PullResponse = z.infer<typeof PullResponseSchema>

/** `GET /api/sync/snapshot[?space=<id>]`. */
export const SnapshotResponseSchema = z.object({
  protocol: z.number().int(),
  entities: z.array(SpacedRecordSchema),
  spaces: z.array(SpaceInfoSchema),
  cursor: SpaceCursorSchema,
})
export type SnapshotResponse = z.infer<typeof SnapshotResponseSchema>

/** The most changes in one push. */
export const MAX_PUSH_CHANGES = 1000

/** `POST /api/sync/push` body. */
export const PushRequestSchema = z.object({
  changes: z.array(Change).max(MAX_PUSH_CHANGES),
  /** The client's cursor, so the answer can move it past its own changes. */
  cursor: SpaceCursorSchema.optional(),
})
export type PushRequest = z.infer<typeof PushRequestSchema>

/** Where a pushed entity is now: the answer to a push that created or moved it. */
export const PlacedSchema = EntityKeySchema.extend({ spaceId: SpaceId })
export type Placed = z.infer<typeof PlacedSchema>

/** `POST /api/sync/push` answer. */
export const PushResponseSchema = z.object({
  applied: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  /**
   * Only when the push sent a `cursor`: the spaces where nothing but this push
   * happened after that cursor, with the cursor moved past the pushed changes,
   * so the client need not pull its own changes back. Merge with the maximum.
   */
  cursor: SpaceCursorSchema.optional(),
  /**
   * The space of every entity this push created or moved (with the children
   * that moved along, and tags made in the target space for moved tasks and
   * projects). Absent when there are none. A space where a move happened is
   * never in `cursor`: pull it to get what the server changed along with it.
   */
  placed: z.array(PlacedSchema).optional(),
})
export type PushResponse = z.infer<typeof PushResponseSchema>

/** Merges cursors, keeping the highest `seq` per space. */
export function mergeCursor(base: SpaceCursor, update: SpaceCursor | undefined): SpaceCursor {
  const out = { ...base }
  for (const [space, seq] of Object.entries(update ?? {})) {
    out[space] = Math.max(out[space] ?? 0, seq)
  }
  return out
}
