import { createHash } from 'node:crypto'
import type { AgentGrant, MemberId } from '@dingen/core'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { Db } from '../db.js'
import type { AppEnv } from '../env.js'
import { agentGrants, apiTokens } from '../schema.js'

export interface RequestAccess {
  /** Who is asking. */
  actor: MemberId
  /** The agent's grants; null for the owner (no limits). */
  grants: AgentGrant[] | null
}

/**
 * Who makes this request and what it may read. A session is the owner; a token
 * belongs to an agent and brings that agent's grants.
 *
 * Interim helper until agents-server puts the actor and grants on the request
 * context; then this becomes a one-line read of that.
 */
export function requestAccess(c: Context<AppEnv>, db: Db): RequestAccess {
  const owner: RequestAccess = { actor: `user:${c.get('userId')}`, grants: null }
  if (c.get('authSource') !== 'token') return owner
  const header = c.req.header('authorization') ?? ''
  const secret = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!secret) return owner
  const hash = createHash('sha256').update(secret).digest('hex')
  const token = db
    .select({ agentId: apiTokens.agentId })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash))
    .get()
  if (!token?.agentId) return owner
  return { actor: `agent:${token.agentId}`, grants: grantsOf(db, token.agentId) }
}

export function grantsOf(db: Db, agentId: string): AgentGrant[] {
  return db
    .select()
    .from(agentGrants)
    .where(eq(agentGrants.agentId, agentId))
    .all()
    .map((g): AgentGrant => {
      if (g.scope === 'area' || g.scope === 'project') {
        return { scope: g.scope, id: g.scopeId, level: g.level }
      }
      return { scope: g.scope, level: g.level }
    })
}
