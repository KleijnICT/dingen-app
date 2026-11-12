import {
  type AgentGrant,
  type AgentLevel,
  allows,
  type Change,
  type EntityRecord,
  type EntityType,
  isDeleted,
  levelFor,
  type MemberId,
  type Place,
  parseMemberId,
} from '@dingen/core'

/**
 * Access checks for agents (plan 19), in one place. Every entity sits in a
 * `Place`: a task via its project (and that project's area) or its area, else
 * the inbox; a heading via its project; a checklist item via its task; a
 * project via itself and its area; an area via itself. Tags are names and are
 * always readable. Reviews belong to the whole account and need an `all` grant.
 */

/** Who is acting on a request: the owner (`grants: null`) or one of their agents. */
export interface Access {
  userId: string
  actor: MemberId
  /** null = the owner, without limits. */
  grants: AgentGrant[] | null
}

export function ownerAccess(userId: string): Access {
  return { userId, actor: `user:${userId}`, grants: null }
}

/** A refused write or read; the API answers 403 `agent_scope`, the MCP shows the message. */
export class AgentScopeError extends Error {
  readonly code = 'agent_scope'
}

/** Finds the current record of an entity (or undefined). */
export type Lookup = (entityType: EntityType, id: string) => EntityRecord | undefined

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Where an entity lives, or null for entities without a place (tags, reviews).
 * A dangling reference (project gone) falls back to the inbox, so it never
 * opens up more than the inbox.
 */
export function placeOf(
  entityType: EntityType,
  data: Record<string, unknown>,
  id: string,
  lookup: Lookup,
  depth = 0,
): Place | null {
  switch (entityType) {
    case 'area':
      return { kind: 'area', areaId: id }
    case 'project':
      return { kind: 'project', projectId: id, areaId: str(data.areaId) }
    case 'heading': {
      const projectId = str(data.projectId)
      if (!projectId) return { kind: 'inbox' }
      return { kind: 'project', projectId, areaId: str(lookup('project', projectId)?.data.areaId) }
    }
    case 'task': {
      const projectId = str(data.projectId)
      if (projectId) {
        return {
          kind: 'project',
          projectId,
          areaId: str(lookup('project', projectId)?.data.areaId),
        }
      }
      const areaId = str(data.areaId)
      return areaId ? { kind: 'area', areaId } : { kind: 'inbox' }
    }
    case 'checklistItem': {
      const taskId = str(data.taskId)
      const task = taskId ? lookup('task', taskId) : undefined
      if (!task || depth > 2) return { kind: 'inbox' }
      return placeOf('task', task.data, task.id, lookup, depth + 1)
    }
    case 'tag':
    case 'review':
      return null
  }
}

/** True when the grants include `all` at `level` or higher. */
export function hasAll(grants: AgentGrant[] | null, level: AgentLevel): boolean {
  if (grants === null) return true
  return grants.some((g) => g.scope === 'all' && allows(g.level, level))
}

/** True when any grant gives at least `level` somewhere. */
function hasAny(grants: AgentGrant[] | null, level: AgentLevel): boolean {
  if (grants === null) return true
  return grants.some((g) => allows(g.level, level))
}

/** The level `grants` give on one entity. Tags: read for everyone; reviews: the `all` grant. */
export function levelOn(
  grants: AgentGrant[] | null,
  entityType: EntityType,
  data: Record<string, unknown>,
  id: string,
  lookup: Lookup,
): AgentLevel | null {
  if (grants === null) return 'manage'
  if (entityType === 'tag') return 'read'
  const place = placeOf(entityType, data, id, lookup)
  if (place === null) {
    const all = grants.find((g) => g.scope === 'all')
    return all ? all.level : null
  }
  return levelFor(grants, place)
}

export function canRead(
  grants: AgentGrant[] | null,
  record: EntityRecord,
  lookup: Lookup,
): boolean {
  return allows(levelOn(grants, record.entityType, record.data, record.id, lookup), 'read')
}

/** Tasks and checklist items need `edit`; projects, headings and areas `manage`. */
function neededFor(entityType: EntityType): AgentLevel {
  return entityType === 'task' || entityType === 'checklistItem' || entityType === 'review'
    ? 'edit'
    : 'manage'
}

/** Is `memberId` someone who can be assigned: the owner or a live agent, and with what grants. */
export type MemberGrants = (memberId: string) => AgentGrant[] | null | undefined

const LABEL: Record<EntityType, string> = {
  area: 'area',
  project: 'project',
  heading: 'heading',
  task: 'task',
  checklistItem: 'checklist item',
  review: 'review',
  tag: 'tag',
}

/**
 * Checks one change by an agent against the state before and after it.
 * Returns a problem text, or null when it is allowed. The owner may do anything.
 */
export function checkWrite(
  access: Access,
  change: Change,
  before: EntityRecord | undefined,
  after: EntityRecord,
  lookup: Lookup,
  members: MemberGrants,
): string | null {
  const { grants } = access
  if (grants === null) return null
  const type = change.entityType
  const what = LABEL[type]

  if (type === 'tag') {
    // Creating a tag needs edit somewhere; changing or deleting one changes every list.
    if (!before) return hasAny(grants, 'edit') ? null : 'This agent may not create tags'
    return hasAll(grants, 'manage') ? null : 'Changing a tag needs manage on everything'
  }

  const needed = neededFor(type)
  if (before && !isDeleted(before)) {
    const level = levelOn(grants, type, before.data, before.id, lookup)
    if (!allows(level, needed)) {
      return allows(level, 'read')
        ? `This agent may not change this ${what} (needs ${needed})`
        : `No ${what} ${change.entityId} in this agent's scope`
    }
  }
  const level = levelOn(grants, type, after.data, after.id, lookup)
  if (!allows(level, needed)) {
    return before
      ? `Moving this ${what} there is outside this agent's scope`
      : `Creating a ${what} there is outside this agent's scope (needs ${needed})`
  }

  if (type === 'task' && 'assigneeId' in change.fields) {
    const assignee = change.fields.assigneeId
    if (assignee !== null && assignee !== undefined) {
      const problem = checkAssignee(String(assignee), after, lookup, members)
      if (problem) return problem
    }
  }
  return null
}

function checkAssignee(
  assignee: string,
  task: EntityRecord,
  lookup: Lookup,
  members: MemberGrants,
): string | null {
  if (!parseMemberId(assignee)) return `"${assignee}" is not a member id`
  const grants = members(assignee)
  if (grants === undefined) return `No member ${assignee}`
  if (!canRead(grants, task, lookup)) return `${assignee} cannot see this task`
  return null
}
