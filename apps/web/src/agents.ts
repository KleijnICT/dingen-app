import {
  AGENT_LEVELS,
  type Agent,
  type AgentGrant,
  type AgentLevel,
  type AgentScope,
  levelFor,
  type MemberId,
  type Place,
  type Project,
  type Task,
} from '@dingen/core'
import { useEffect, useState } from 'react'
import { api } from './api.js'
import { loadMembers } from './components/MemberAvatar.js'

/**
 * Agents in the web app (plan 19): the calls to `/api/agents` and
 * `/api/access`, a small shared cache, and the pure helpers the settings,
 * the members panel and assigning use.
 */

export interface AgentInput {
  name: string
  icon: string
  color: string
  grants: AgentGrant[]
}

export interface AccessEntry {
  member: MemberId
  level: AgentLevel
}

export type AccessType = 'area' | 'project'

let cache: Promise<Agent[]> | null = null
let current: Agent[] | null = null
const listeners = new Set<() => void>()

/** The signed-in user's agents (`GET /api/agents`), fetched once and shared. */
export function loadAgents(refresh = false): Promise<Agent[]> {
  if (!cache || refresh) {
    cache = api
      .get<{ agents: Agent[] }>('/api/agents')
      .then((r) => r.agents)
      .catch(() => {
        cache = null
        return []
      })
    void cache.then((agents) => {
      current = agents
      for (const l of listeners) l()
    })
  }
  return cache
}

/** Reloads agents and members after a change, so every view shows the same. */
export async function refreshAgents(): Promise<void> {
  await Promise.all([loadAgents(true), loadMembers(true)])
}

/** The agents (empty while loading), kept current across components. */
export function useAgents(): Agent[] {
  const [agents, setAgents] = useState<Agent[]>(current ?? [])
  useEffect(() => {
    const update = () => setAgents(current ?? [])
    listeners.add(update)
    void loadAgents().then(update)
    return () => {
      listeners.delete(update)
    }
  }, [])
  return agents
}

export const agentsApi = {
  create: (input: AgentInput) => api.post<{ agent: Agent; token: string }>('/api/agents', input),
  update: (id: string, input: Partial<AgentInput>) =>
    api.patch<{ agent: Agent }>(`/api/agents/${id}`, input),
  rotate: (id: string) => api.post<{ agent: Agent; token: string }>(`/api/agents/${id}/token`),
  revoke: (id: string) => api.delete<{ ok: true }>(`/api/agents/${id}`),
  access: (type: AccessType, id: string) =>
    api
      .get<{ members: AccessEntry[] }>(`/api/access?type=${type}&id=${encodeURIComponent(id)}`)
      .then((r) => r.members),
}

/** Same scope (ignoring level)? */
export function sameScope(a: AgentScope, b: AgentScope): boolean {
  if (a.scope !== b.scope) return false
  return !('id' in a) || a.id === (b as { id: string }).id
}

/** A stable key for a scope, e.g. `area:abc`. */
export function scopeKey(s: AgentScope): string {
  return 'id' in s ? `${s.scope}:${s.id}` : s.scope
}

export function parseScopeKey(key: string): AgentScope | null {
  if (key === 'all' || key === 'inbox') return { scope: key }
  const m = /^(area|project):(.+)$/.exec(key)
  return m ? { scope: m[1] as 'area' | 'project', id: m[2] as string } : null
}

/**
 * The grants with the grant for `scope` set to `level`, or removed when
 * `level` is null. Other grants are left alone; the order is kept.
 */
export function withGrant(
  grants: readonly AgentGrant[],
  scope: AgentScope,
  level: AgentLevel | null,
): AgentGrant[] {
  const index = grants.findIndex((g) => sameScope(g, scope))
  if (level === null) return grants.filter((_, i) => i !== index)
  const grant = { ...scope, level } as AgentGrant
  if (index === -1) return [...grants, grant]
  return grants.map((g, i) => (i === index ? grant : g))
}

/** The grant made directly for this scope, if any. */
export function directGrant(grants: readonly AgentGrant[], scope: AgentScope) {
  return grants.find((g) => sameScope(g, scope)) ?? null
}

/** The place a project or area is, for `levelFor`. */
export function placeOfContainer(
  type: AccessType,
  id: string,
  projectById: Map<string, Project>,
): Place {
  if (type === 'area') return { kind: 'area', areaId: id }
  return { kind: 'project', projectId: id, areaId: projectById.get(id)?.areaId ?? null }
}

/** Where a task lives, for `levelFor`: its project (and that project's area), its area, or the Inbox. */
export function placeOfTask(task: Task, projectById: Map<string, Project>): Place {
  if (task.projectId) return placeOfContainer('project', task.projectId, projectById)
  if (task.areaId) return { kind: 'area', areaId: task.areaId }
  return { kind: 'inbox' }
}

/**
 * The level an agent has on `place` through grants other than the direct one
 * for `scope` (e.g. via "Everything" or via the project's area), or null.
 */
export function inheritedLevel(
  grants: readonly AgentGrant[],
  scope: AgentScope,
  place: Place,
): AgentLevel | null {
  return levelFor(
    grants.filter((g) => !sameScope(g, scope)),
    place,
  )
}

/** The agents that can reach a task at any level; only these may be assigned. */
export function agentsForTask(
  agents: readonly Agent[],
  task: Task,
  projectById: Map<string, Project>,
): Agent[] {
  const place = placeOfTask(task, projectById)
  return agents.filter((a) => levelFor(a.grants, place) !== null)
}

/** Levels at or above `floor` (all levels when null). */
export function levelsFrom(floor: AgentLevel | null): AgentLevel[] {
  return floor === null ? [...AGENT_LEVELS] : AGENT_LEVELS.slice(AGENT_LEVELS.indexOf(floor))
}

/** Grants sorted for display: Everything, Inbox, then areas and projects. */
export function sortGrants(grants: readonly AgentGrant[]): AgentGrant[] {
  const rank = { all: 0, inbox: 1, area: 2, project: 3 } as const
  return [...grants].sort((a, b) => rank[a.scope] - rank[b.scope])
}
