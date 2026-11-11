import { createHash, randomBytes } from 'node:crypto'
import { ulid } from '@dingen/core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Db } from '../db.js'
import { invitations, users } from '../schema.js'

/** Een uitnodiging is 14 dagen geldig. */
export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000

export type InvitationStatus = 'open' | 'used' | 'expired' | 'revoked'

export interface InvitationInfo {
  id: string
  createdAt: string
  expiresAt: string
  createdBy: string | null
  usedAt: string | null
  usedBy: string | null
  revokedAt: string | null
  status: InvitationStatus
}

/** Waarom een uitnodiging niet (meer) bruikbaar is. */
export type InvitationProblem =
  | 'invite_invalid'
  | 'invite_expired'
  | 'invite_used'
  | 'invite_revoked'

type Row = typeof invitations.$inferSelect

export function hashInvitation(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function invitationStatus(
  row: Pick<Row, 'usedAt' | 'revokedAt' | 'expiresAt'>,
  now: Date,
): InvitationStatus {
  if (row.usedAt) return 'used'
  if (row.revokedAt) return 'revoked'
  if (row.expiresAt <= now.toISOString()) return 'expired'
  return 'open'
}

const PROBLEM: Record<Exclude<InvitationStatus, 'open'>, InvitationProblem> = {
  used: 'invite_used',
  revoked: 'invite_revoked',
  expired: 'invite_expired',
}

/**
 * Zoekt de uitnodiging bij een geheim en zegt of hij bruikbaar is. Werkt op
 * `db` of op een transactie, zodat registreren hem atomair kan verbruiken.
 */
export function checkInvitation(
  db: Pick<Db, 'select'>,
  secret: string,
  now = new Date(),
): { ok: true; row: Row } | { ok: false; problem: InvitationProblem } {
  const row = db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, hashInvitation(secret)))
    .get()
  if (!row) return { ok: false, problem: 'invite_invalid' }
  const status = invitationStatus(row, now)
  return status === 'open' ? { ok: true, row } : { ok: false, problem: PROBLEM[status] }
}

export class InvitationService {
  constructor(
    private readonly db: Db,
    private readonly ttlMs = INVITATION_TTL_MS,
  ) {}

  /** Maakt een uitnodiging en geeft het geheim één keer terug. */
  create(createdBy: string, now = new Date()): { token: string; info: InvitationInfo } {
    const token = randomBytes(32).toString('base64url')
    const row = {
      id: ulid(),
      tokenHash: hashInvitation(token),
      createdBy,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
    }
    this.db.insert(invitations).values(row).run()
    const creator = this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, createdBy))
      .get()
    return {
      token,
      info: {
        id: row.id,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        createdBy: creator?.email ?? null,
        usedAt: null,
        usedBy: null,
        revokedAt: null,
        status: 'open',
      },
    }
  }

  /** Alle uitnodigingen van deze installatie, nieuwste eerst. */
  list(now = new Date()): InvitationInfo[] {
    const creator = alias(users, 'creator')
    const user = alias(users, 'used_by_user')
    const rows = this.db
      .select({
        id: invitations.id,
        createdAt: invitations.createdAt,
        expiresAt: invitations.expiresAt,
        usedAt: invitations.usedAt,
        revokedAt: invitations.revokedAt,
        createdBy: creator.email,
        usedBy: user.email,
      })
      .from(invitations)
      .leftJoin(creator, eq(creator.id, invitations.createdBy))
      .leftJoin(user, eq(user.id, invitations.usedBy))
      .orderBy(desc(invitations.createdAt), desc(invitations.id))
      .all()
    return rows.map((r) => ({ ...r, status: invitationStatus(r, now) }))
  }

  /** Trekt een nog niet gebruikte uitnodiging in. */
  revoke(id: string, now = new Date()): 'ok' | 'not_found' | 'already_used' {
    const row = this.db.select().from(invitations).where(eq(invitations.id, id)).get()
    if (!row) return 'not_found'
    if (row.usedAt) return 'already_used'
    this.db
      .update(invitations)
      .set({ revokedAt: now.toISOString() })
      .where(and(eq(invitations.id, id), isNull(invitations.revokedAt)))
      .run()
    return 'ok'
  }
}
