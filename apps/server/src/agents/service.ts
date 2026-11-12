import { createHash, randomBytes } from 'node:crypto'
import {
  type Agent,
  type AgentGrant,
  type AgentLevel,
  levelFor,
  type Member,
  type MemberId,
  type Place,
  parseMemberId,
  ulid,
} from '@dingen/core'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Db } from '../db.js'
import { agentGrants, agents, apiTokens, users } from '../schema.js'
import type { MemberGrants } from './access.js'

export const TOKEN_PREFIX = 'dgn_'

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export interface AgentInput {
  name: string
  icon: string
  color: string
  grants: AgentGrant[]
}

type AgentRow = typeof agents.$inferSelect
type GrantRow = typeof agentGrants.$inferSelect

function toGrant(row: GrantRow): AgentGrant {
  switch (row.scope) {
    case 'all':
    case 'inbox':
      return { scope: row.scope, level: row.level }
    default:
      return { scope: row.scope, id: row.scopeId, level: row.level }
  }
}

function grantRow(agentId: string, g: AgentGrant): GrantRow {
  return {
    agentId,
    scope: g.scope,
    scopeId: g.scope === 'area' || g.scope === 'project' ? g.id : '',
    level: g.level,
  }
}

/** One grant per scope; a later duplicate wins. */
export function normalizeGrants(grants: AgentGrant[]): AgentGrant[] {
  const byKey = new Map<string, AgentGrant>()
  for (const g of grants) {
    const id = g.scope === 'area' || g.scope === 'project' ? g.id : ''
    byKey.set(`${g.scope}:${id}`, g)
  }
  return [...byKey.values()]
}

/** Agents of a user: their tokens, grants, and the member list (plan 19). */
export class AgentService {
  constructor(private readonly db: Db) {}

  /** Resolves an API token to its user and live agent; updates `lastUsedAt`. */
  resolveToken(secret: string): { userId: string; agentId: string; grants: AgentGrant[] } | null {
    if (!secret.startsWith(TOKEN_PREFIX)) return null
    const row = this.db
      .select({ tokenId: apiTokens.id, userId: apiTokens.userId, agentId: agents.id })
      .from(apiTokens)
      .innerJoin(agents, eq(agents.id, apiTokens.agentId))
      .where(and(eq(apiTokens.tokenHash, sha256(secret)), isNull(agents.revokedAt)))
      .get()
    if (!row) return null
    this.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiTokens.id, row.tokenId))
      .run()
    return { userId: row.userId, agentId: row.agentId, grants: this.grantsOf(row.agentId) }
  }

  grantsOf(agentId: string): AgentGrant[] {
    return this.db
      .select()
      .from(agentGrants)
      .where(eq(agentGrants.agentId, agentId))
      .all()
      .map(toGrant)
  }

  private liveRows(userId: string): AgentRow[] {
    return this.db
      .select()
      .from(agents)
      .where(and(eq(agents.userId, userId), isNull(agents.revokedAt)))
      .orderBy(asc(agents.createdAt), asc(agents.id))
      .all()
  }

  private liveRow(userId: string, agentId: string): AgentRow | undefined {
    return this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, userId), isNull(agents.revokedAt)))
      .get()
  }

  private toAgents(rows: AgentRow[]): Agent[] {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const grants = this.db.select().from(agentGrants).where(inArray(agentGrants.agentId, ids)).all()
    const tokens = this.db
      .select({
        agentId: apiTokens.agentId,
        prefix: apiTokens.prefix,
        lastUsedAt: apiTokens.lastUsedAt,
      })
      .from(apiTokens)
      .where(inArray(apiTokens.agentId, ids))
      .all()
    return rows.map((r) => {
      const token = tokens.find((t) => t.agentId === r.id)
      return {
        id: r.id,
        name: r.name,
        icon: r.icon,
        color: r.color,
        createdAt: r.createdAt,
        lastUsedAt: token?.lastUsedAt ?? null,
        tokenPrefix: token?.prefix ?? null,
        grants: grants.filter((g) => g.agentId === r.id).map(toGrant),
      }
    })
  }

  list(userId: string): Agent[] {
    return this.toAgents(this.liveRows(userId))
  }

  get(userId: string, agentId: string): Agent | null {
    const row = this.liveRow(userId, agentId)
    return row ? (this.toAgents([row])[0] ?? null) : null
  }

  create(userId: string, input: AgentInput): { agent: Agent; token: string } {
    const id = ulid()
    const token = this.db.transaction((tx) => {
      tx.insert(agents)
        .values({
          id,
          userId,
          name: input.name,
          icon: input.icon,
          color: input.color,
          createdAt: new Date().toISOString(),
        })
        .run()
      const grants = normalizeGrants(input.grants)
      if (grants.length > 0)
        tx.insert(agentGrants)
          .values(grants.map((g) => grantRow(id, g)))
          .run()
      return this.issueToken(tx, userId, id, input.name)
    })
    return { agent: this.get(userId, id) as Agent, token }
  }

  update(
    userId: string,
    agentId: string,
    patch: { [K in keyof AgentInput]?: AgentInput[K] | undefined },
  ): Agent | null {
    if (!this.liveRow(userId, agentId)) return null
    this.db.transaction((tx) => {
      const fields: Partial<AgentRow> = {}
      if (patch.name !== undefined) fields.name = patch.name
      if (patch.icon !== undefined) fields.icon = patch.icon
      if (patch.color !== undefined) fields.color = patch.color
      if (Object.keys(fields).length > 0)
        tx.update(agents).set(fields).where(eq(agents.id, agentId)).run()
      if (patch.name !== undefined)
        tx.update(apiTokens).set({ name: patch.name }).where(eq(apiTokens.agentId, agentId)).run()
      if (patch.grants !== undefined) {
        tx.delete(agentGrants).where(eq(agentGrants.agentId, agentId)).run()
        const grants = normalizeGrants(patch.grants)
        if (grants.length > 0)
          tx.insert(agentGrants)
            .values(grants.map((g) => grantRow(agentId, g)))
            .run()
      }
    })
    return this.get(userId, agentId)
  }

  /** A new token for the agent; the old one stops working. */
  rotate(userId: string, agentId: string): { agent: Agent; token: string } | null {
    const row = this.liveRow(userId, agentId)
    if (!row) return null
    const token = this.db.transaction((tx) => this.issueToken(tx, userId, agentId, row.name))
    return { agent: this.get(userId, agentId) as Agent, token }
  }

  /** Revokes the agent: its token stops, its past changes stay attributed to it. */
  revoke(userId: string, agentId: string): boolean {
    if (!this.liveRow(userId, agentId)) return false
    this.db.transaction((tx) => {
      tx.update(agents)
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(agents.id, agentId))
        .run()
      tx.delete(apiTokens).where(eq(apiTokens.agentId, agentId)).run()
    })
    return true
  }

  private issueToken(tx: Db, userId: string, agentId: string, name: string): string {
    tx.delete(apiTokens).where(eq(apiTokens.agentId, agentId)).run()
    const secret = TOKEN_PREFIX + randomBytes(32).toString('base64url')
    tx.insert(apiTokens)
      .values({
        id: ulid(),
        userId,
        agentId,
        name,
        prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
        tokenHash: sha256(secret),
        createdAt: new Date().toISOString(),
      })
      .run()
    return secret
  }

  /** The owner plus their live agents. */
  members(userId: string): Member[] {
    const owner = this.db.select().from(users).where(eq(users.id, userId)).get()
    const list: Member[] = []
    if (owner)
      list.push({
        id: `user:${owner.id}`,
        kind: 'user',
        name: owner.email,
        icon: null,
        color: null,
      })
    for (const a of this.liveRows(userId)) {
      list.push({ id: `agent:${a.id}`, kind: 'agent', name: a.name, icon: a.icon, color: a.color })
    }
    return list
  }

  /** Grants per member of this user: null for the owner, undefined for strangers. */
  memberGrants(userId: string): MemberGrants {
    const cache = new Map<string, AgentGrant[] | null | undefined>()
    return (member) => {
      if (cache.has(member)) return cache.get(member)
      const parsed = parseMemberId(member)
      let result: AgentGrant[] | null | undefined
      if (parsed?.kind === 'user') result = parsed.id === userId ? null : undefined
      else if (parsed?.kind === 'agent')
        result = this.liveRow(userId, parsed.id) ? this.grantsOf(parsed.id) : undefined
      cache.set(member, result)
      return result
    }
  }

  /** Who reaches `place`, at which level; the owner always with `manage`. */
  accessTo(userId: string, place: Place): { member: MemberId; level: AgentLevel }[] {
    const result: { member: MemberId; level: AgentLevel }[] = [
      { member: `user:${userId}`, level: 'manage' },
    ]
    for (const a of this.list(userId)) {
      const level = levelFor(a.grants, place)
      if (level) result.push({ member: `agent:${a.id}`, level })
    }
    return result
  }
}
