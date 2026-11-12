/**
 * Members (plan 19): the people and agents that can act on a user's data.
 * A member id is `user:<id>` or `agent:<id>`; it is the `actor` of a change and
 * the value of `Task.assigneeId`.
 */

export type MemberId = `user:${string}` | `agent:${string}`

export const memberId = {
  user: (id: string): MemberId => `user:${id}`,
  agent: (id: string): MemberId => `agent:${id}`,
}

/** Parses a member id; null when it is not one. */
export function parseMemberId(value: string): { kind: 'user' | 'agent'; id: string } | null {
  const m = /^(user|agent):(.+)$/.exec(value)
  return m ? { kind: m[1] as 'user' | 'agent', id: m[2] as string } : null
}

/** Access levels, lowest first. */
export const AGENT_LEVELS = ['read', 'edit', 'manage'] as const
export type AgentLevel = (typeof AGENT_LEVELS)[number]

/** Where a grant applies. `inbox` = tasks without project and area. */
export type AgentScope =
  | { scope: 'all' }
  | { scope: 'inbox' }
  | { scope: 'area'; id: string }
  | { scope: 'project'; id: string }

export type AgentGrant = AgentScope & { level: AgentLevel }

/** An agent as the API returns it (never with its token). */
export interface Agent {
  id: string
  name: string
  icon: string
  color: string
  createdAt: string
  lastUsedAt: string | null
  /** Token prefix for recognition, e.g. `dgn_ab12`; null when it has no token. */
  tokenPrefix: string | null
  grants: AgentGrant[]
}

/** Anyone who can appear as actor or assignee. */
export interface Member {
  id: MemberId
  kind: 'user' | 'agent'
  name: string
  /** Agents: area icon id and colour id. Users: null. */
  icon: string | null
  color: string | null
}

/** One line in the activity log (Logbook). */
export interface ActivityItem {
  /** `seq` of the last change folded into this line; used for paging. */
  seq: number
  at: string
  actor: MemberId
  kind: 'added' | 'completed' | 'reopened' | 'updated' | 'deleted'
  entityType: string
  entityId: string
  title: string
  /** The project or area the entity sits in, when there is one. */
  container: { type: 'project' | 'area'; id: string; title: string } | null
  /** For `updated`: the fields that changed. Notes only say that they changed. */
  fields: { field: string; from: unknown; to: unknown }[]
}

export const ACTIVITY_KINDS = ['added', 'completed', 'reopened', 'updated', 'deleted'] as const
