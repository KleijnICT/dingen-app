/**
 * Members (plan 19): the people and agents that can act on a user's data.
 * A member id is `user:<id>` or `agent:<id>`; it is the `actor` of a change and
 * the value of `Task.assigneeId`.
 */

export type MemberId = `user:${string}` | `agent:${string}`

/**
 * The server itself, as the author of a change it makes on its own (a data
 * migration such as lowercasing tags). Never an assignee.
 */
export const SYSTEM_ACTOR = 'system'

/** Who made a change: a member, or the server itself. */
export type ActorId = MemberId | typeof SYSTEM_ACTOR

/** Is this a valid actor: a member id or `system`? */
export function isActorId(value: string): value is ActorId {
  return value === SYSTEM_ACTOR || parseMemberId(value) !== null
}

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
  actor: ActorId
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

/** Where an entity lives, for access checks. */
export type Place =
  | { kind: 'inbox' }
  | { kind: 'area'; areaId: string }
  | { kind: 'project'; projectId: string; areaId: string | null }

const rank = (level: AgentLevel) => AGENT_LEVELS.indexOf(level)

/**
 * The highest level any grant gives on `place`, or null for no access.
 * `all` reaches everything; an area grant reaches the area and its projects;
 * a project grant reaches that project; `inbox` reaches tasks without project
 * and area. `grants === null` means the owner (no limits).
 */
export function levelFor(grants: readonly AgentGrant[] | null, place: Place): AgentLevel | null {
  if (grants === null) return 'manage'
  let best: AgentLevel | null = null
  for (const g of grants) {
    const reaches =
      g.scope === 'all' ||
      (g.scope === 'inbox' && place.kind === 'inbox') ||
      (g.scope === 'area' &&
        ((place.kind === 'area' && place.areaId === g.id) ||
          (place.kind === 'project' && place.areaId === g.id))) ||
      (g.scope === 'project' && place.kind === 'project' && place.projectId === g.id)
    if (reaches && (best === null || rank(g.level) > rank(best))) best = g.level
  }
  return best
}

/** True when `level` is at least `needed`. */
export function allows(level: AgentLevel | null, needed: AgentLevel): boolean {
  return level !== null && rank(level) >= rank(needed)
}
