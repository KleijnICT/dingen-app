import { z } from 'zod'
import type { Change } from './entities.js'
import type { EntityRecord } from './sync.js'

/**
 * The sync protocol between clients and the server.
 *
 * - Protocol 1: one cursor for the whole account (`pull?since=<seq>`).
 * - Protocol 2 (plan 23): a cursor per space (`pull?cursor={"<spaceId>":<seq>}`),
 *   so a space that is shared with you later starts with a snapshot of that
 *   space and a space you leave is reported so you drop its data.
 *
 * `seq` stays one counter for the whole server; a cursor per space is the
 * highest `seq` of that space the client has seen.
 */
export const SYNC_PROTOCOL = 2

/** The highest `seq` seen per space id. */
export type SpaceCursor = Record<string, number>

export const SpaceCursorSchema = z.record(z.string().min(1).max(64), z.number().int().min(0))

/**
 * The `cursor` query parameter of a pull: a JSON object per space, or (to move
 * a stored protocol 1 cursor over) a single number that counts for every
 * space of the user. Returns null when it cannot be read.
 */
export function parseCursorParam(raw: string): SpaceCursor | number | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null
  const parsed = SpaceCursorSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export type SpaceKind = 'personal' | 'shared'
export type SpaceLevel = 'read' | 'edit' | 'manage'

/** A space the user is a member of. */
export interface SpaceInfo {
  id: string
  kind: SpaceKind
  level: SpaceLevel
}

/** A record with the space it lives in; what snapshots deliver. */
export interface SpacedRecord extends EntityRecord {
  spaceId: string
}

/** One space in a protocol 2 pull. */
export interface PullSpace extends SpaceInfo {
  /** The cursor for this space after applying this answer. */
  seq: number
  /** Changes after the client's cursor for this space, oldest first. */
  changes: Change[]
  /**
   * Only for a space the client did not know (absent from its cursor): every
   * live entity of the space. The client replaces what it had for this space.
   * `changes` is then empty.
   */
  entities?: EntityRecord[]
  /** This space has more changes than fitted in this answer. */
  hasMore: boolean
}

/** `GET /api/sync/pull?cursor=…` (protocol 2). */
export interface PullResponse {
  protocol: number
  spaces: PullSpace[]
  /** Spaces in the client's cursor the user is no longer a member of: drop their data. */
  removed: string[]
  /** The full new cursor: one entry per space of the user. */
  cursor: SpaceCursor
  /** Pull again with the new cursor: some space has more. */
  hasMore: boolean
}

/** `GET /api/sync/snapshot` (protocol 2 fields plus the protocol 1 `seq`). */
export interface SnapshotResponse {
  protocol: number
  entities: SpacedRecord[]
  spaces: SpaceInfo[]
  cursor: SpaceCursor
  /** Protocol 1: the highest `seq` over all the user's spaces. */
  seq: number
}

/** `POST /api/sync/push` answer. */
export interface PushResponse {
  /** Protocol 1: the highest `seq` over all the user's spaces (not a safe cursor). */
  seq: number
  applied: number
  duplicates: number
  /**
   * Only when the push sent a `cursor`: the spaces where nothing but this push
   * happened after that cursor, with the cursor moved past the pushed changes,
   * so the client need not pull its own changes back. Merge with the maximum.
   */
  cursor?: SpaceCursor
}

/** Merges cursors, keeping the highest `seq` per space. */
export function mergeCursor(base: SpaceCursor, update: SpaceCursor | undefined): SpaceCursor {
  const out = { ...base }
  for (const [space, seq] of Object.entries(update ?? {})) {
    out[space] = Math.max(out[space] ?? 0, seq)
  }
  return out
}
