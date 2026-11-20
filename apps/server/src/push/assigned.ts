import {
  type ActorId,
  type Change,
  type EntityRecord,
  isDeleted,
  parseMemberId,
} from '@dingen/core'
import { eq } from 'drizzle-orm'
import type { Db } from '../db.js'
import { agents } from '../schema.js'
import { type PushLocale, pushMessages } from './messages.js'
import type { PushPayload, PushService } from './service.js'

/** An agent gave a task to a person (plan 19, decision 10). */
export interface Assignment {
  /** The person the task now belongs to. */
  userId: string
  /** The agent that assigned it. */
  agentId: string
  taskId: string
  title: string
  projectId: string | null
  areaId: string | null
}

/**
 * The assignment in one applied change, or null. Only an agent assigning an
 * open task to a person counts, and only when the assignee actually changes:
 * a person assigning (also to themselves), an agent sending the same assignee
 * again, or an agent completing a task gives no notification. A change that is
 * replayed (same id) never gets here: the sync service skips it.
 */
export function assignmentIn(
  actor: ActorId,
  change: Change,
  before: Record<string, unknown> | undefined,
  after: EntityRecord,
): Assignment | null {
  if (change.entityType !== 'task' || !('assigneeId' in change.fields)) return null
  const by = parseMemberId(actor)
  if (by?.kind !== 'agent') return null
  const assignee = after.data.assigneeId
  if (typeof assignee !== 'string' || assignee === before?.assigneeId) return null
  const to = parseMemberId(assignee)
  if (to?.kind !== 'user') return null
  if (isDeleted(after) || after.data.status !== 'open') return null
  const text = (field: string) => {
    const value = after.data[field]
    return typeof value === 'string' && value ? value : null
  }
  return {
    userId: to.id,
    agentId: by.id,
    taskId: after.id,
    title: text('title') ?? '',
    projectId: text('projectId'),
    areaId: text('areaId'),
  }
}

/** The app path that opens the task in the panel, in its project or area when it has one. */
export function taskUrl(a: Pick<Assignment, 'taskId' | 'projectId' | 'areaId'>): string {
  const path = a.projectId ? `/project/${a.projectId}` : a.areaId ? `/area/${a.areaId}` : '/today'
  return `${path}?task=${encodeURIComponent(a.taskId)}`
}

/**
 * Sends a web push to the assignee's devices. Without a push subscription (push
 * not switched on in Settings) nothing goes out. Each device gets the text in
 * the language it subscribed with (English when it did not tell).
 */
export class AssignmentNotifier {
  constructor(
    private readonly db: Db,
    private readonly push: PushService,
  ) {}

  /** The notification for one assignment, rendered in `locale`. */
  payload(a: Assignment): (locale: PushLocale) => PushPayload {
    const agent = this.db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, a.agentId))
      .get()
    const name = agent?.name?.trim()
    return (locale) => {
      const m = pushMessages(locale)
      return {
        title: m.assigned(name || m.anAgent),
        body: a.title || m.untitled,
        tag: a.taskId,
        url: taskUrl(a),
      }
    }
  }

  async notify(list: readonly Assignment[]): Promise<void> {
    await Promise.all(list.map((a) => this.push.send(a.userId, this.payload(a))))
  }
}
