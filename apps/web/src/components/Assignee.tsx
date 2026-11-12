import type { Member, Task } from '@dingen/core'
import { agentsForTask, useAgents } from '../agents.js'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { commitTask } from '../taskActions.js'
import { agentMember } from './AgentSettings.js'
import { MemberAvatar, useMembers } from './MemberAvatar.js'

/**
 * Assigning a task (plan 19): to nobody, to yourself, or to an agent that can
 * reach the task. Rows show the avatar only for agents; tasks assigned to you
 * look like every other task of yours, which keeps lists calm.
 */

interface Choices {
  /** You, the owner (undefined while the members load). */
  self: Member | undefined
  /** Agents that can reach the task, plus the current assignee if it no longer can. */
  agents: Member[]
  /** True when there is anyone besides you to assign to (else the UI stays hidden). */
  useful: boolean
}

export function useAssignChoices(task: Task): Choices {
  const ws = useWorkspace()
  const agents = useAgents()
  const { members, byId } = useMembers()
  const self = members.find((m) => m.kind === 'user')
  const reachable = agentsForTask(agents, task, ws.projectById).map(agentMember)
  const current = byId(task.assigneeId)
  if (current?.kind === 'agent' && !reachable.some((m) => m.id === current.id)) {
    reachable.push(current)
  }
  return {
    self,
    agents: reachable,
    useful: agents.length > 0 || task.assigneeId !== null,
  }
}

/** The assignee line in the task editor: a select with the avatar in front. */
export function AssigneeField({ task }: { task: Task }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const { self, agents, useful } = useAssignChoices(task)
  const { byId } = useMembers()
  if (!useful) return null
  const current = byId(task.assigneeId)
  const unknown = task.assigneeId !== null && !current

  return (
    <span className="assign-field">
      {task.assigneeId && <MemberAvatar member={current} fallbackId={task.assigneeId} size={20} />}
      <select
        className="move-select"
        value={task.assigneeId ?? ''}
        aria-label={t('assign.label')}
        onChange={(e) => commitTask(engine, ws, task, { assigneeId: e.target.value || null })}
      >
        <option value="">{t('assign.nobody')}</option>
        {self && <option value={self.id}>{t('assign.me')}</option>}
        {agents.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
        {unknown && <option value={task.assigneeId ?? ''}>{t('assign.unknown')}</option>}
      </select>
    </span>
  )
}

/** The list in the toolbar's Assign popup. */
export function AssigneeList({ task, onDone }: { task: Task; onDone: () => void }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const { self, agents } = useAssignChoices(task)

  function pick(assigneeId: string | null) {
    commitTask(engine, ws, task, { assigneeId })
    onDone()
  }
  const item = (key: string, value: string | null, label: string, member?: Member) => (
    <button
      key={key}
      type="button"
      className="move-item"
      aria-pressed={task.assigneeId === value}
      onClick={() => pick(value)}
    >
      {member ? (
        <MemberAvatar member={member} size={18} title={false} />
      ) : (
        <span className="move-none" />
      )}
      <span>{label}</span>
    </button>
  )

  return (
    <div className="move-list">
      {item('none', null, t('assign.nobody'))}
      {self && item(self.id, self.id, t('assign.me'), self)}
      {agents.map((m) => item(m.id, m.id, m.name, m))}
      {agents.length === 0 && <p className="muted assign-hint">{t('assign.noAgents')}</p>}
    </div>
  )
}

/** The small avatar in a task row; only for agents (see the note at the top). */
export function AssigneeBadge({ assigneeId }: { assigneeId: string }) {
  const { byId } = useMembers()
  const member = byId(assigneeId)
  if (member?.kind === 'user' || (!member && !assigneeId.startsWith('agent:'))) return null
  return <MemberAvatar member={member} fallbackId={assigneeId} size={18} />
}
