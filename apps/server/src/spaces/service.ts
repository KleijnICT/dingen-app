import { ulid } from '@dingen/core'
import { and, eq, inArray, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Db } from '../db.js'
import { type SpaceLevel, spaceMembers, spaces } from '../schema.js'

/**
 * Spaces (plan 23): every entity and change lives in one space, and a user
 * reaches data only through the spaces they are a member of. For now each
 * user has exactly one, their personal space; shared spaces come later on the
 * same model.
 */

/** Anything that can run the queries below: the database or a transaction. */
type Queryable = Pick<Db, 'select' | 'insert'>

/**
 * Creates the personal space of a new user and makes them its `manage`
 * member. Call it in the same transaction that inserts the user.
 */
export function createPersonalSpace(db: Queryable, userId: string, createdAt: string): string {
  const id = ulid()
  db.insert(spaces).values({ id, kind: 'personal', ownerId: userId, createdAt }).run()
  db.insert(spaceMembers)
    .values({ spaceId: id, userId, level: 'manage', joinedAt: createdAt })
    .run()
  return id
}

/** The personal space of a user, or null when there is none (unknown user). */
export function personalSpaceOf(db: Queryable, userId: string): string | null {
  const row = db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.ownerId, userId), eq(spaces.kind, 'personal')))
    .get()
  return row?.id ?? null
}

/** The ids of all spaces the user is a member of (any level). */
export function spacesOf(db: Queryable, userId: string): string[] {
  return db
    .select({ id: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, userId))
    .all()
    .map((r) => r.id)
}

/** The ids of the spaces the user owns. */
export function ownedSpacesOf(db: Queryable, userId: string): string[] {
  return db
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.ownerId, userId))
    .all()
    .map((r) => r.id)
}

/** The user's level in a space, or null when they are not a member. */
export function memberLevel(db: Queryable, spaceId: string, userId: string): SpaceLevel | null {
  const row = db
    .select({ level: spaceMembers.level })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
    .get()
  return row?.level ?? null
}

const RANK: Record<SpaceLevel, number> = { read: 0, edit: 1, manage: 2 }

/** Does `level` reach `needed`? Null (no member) reaches nothing. */
export function levelAllows(level: SpaceLevel | null, needed: SpaceLevel): boolean {
  return level !== null && RANK[level] >= RANK[needed]
}

/**
 * Condition "`column` is one of the user's spaces", as a subquery, so a read
 * stays a single statement: `where(inSpacesOf(db, entities.spaceId, userId))`.
 */
export function inSpacesOf(db: Pick<Db, 'select'>, column: SQLiteColumn, userId: string): SQL {
  return inArray(
    column,
    db
      .select({ id: spaceMembers.spaceId })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, userId)),
  )
}

/** The same condition for raw SQL: bind the user id once. */
export const IN_SPACES_OF_USER_SQL =
  'space_id in (select space_id from space_members where user_id = ?)'

/** A write into a space where the user lacks the level for it. */
export class SpaceAccessError extends Error {
  readonly code = 'space_access'
}
