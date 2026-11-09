import {
  type Area,
  firstOccurrence,
  instanceOf,
  nextOccurrence,
  orderBetween,
  type Project,
  type Repeat,
  type Task,
  ulid,
  views,
  type When,
} from '@dingen/core'
import { useEffect, useRef, useState } from 'react'
import type { Workspace } from './store/context.js'
import type { SyncEngine } from './store/engine.js'

/** Where a task can be moved to: a list (sets `when`), a project, a heading, or an area. */
export type MoveTarget =
  | { kind: 'none' }
  | { kind: 'when'; when: When; evening?: boolean }
  | { kind: 'project'; projectId: string; headingId?: string | null }
  | { kind: 'area'; areaId: string }

/** Fields of an open instance that also change its repeating task, so later instances follow. */
const MIRRORED = new Set([
  'title',
  'notes',
  'tagIds',
  'projectId',
  'headingId',
  'areaId',
  'evening',
])

/** The one way to change a task: writes the change and mirrors it to the template when needed. */
export function commitTask(
  engine: SyncEngine,
  ws: Workspace,
  task: Task,
  fields: Record<string, unknown>,
): void {
  if (Object.keys(fields).length === 0) return
  engine.mutate('task', task.id, fields)
  const template = task.templateId ? ws.templateById.get(task.templateId) : undefined
  if (!template || task.status !== 'open') return
  const mirrored = Object.fromEntries(Object.entries(fields).filter(([k]) => MIRRORED.has(k)))
  if (Object.keys(mirrored).length > 0) engine.mutate('task', template.id, mirrored)
}

export function toggleTask(engine: SyncEngine, ws: Workspace, task: Task): void {
  const completing = task.status === 'open'
  engine.mutate('task', task.id, {
    status: completing ? 'completed' : 'open',
    completedAt: completing ? new Date().toISOString() : null,
  })
  if (completing) spawnNext(engine, ws, task, ws.today)
}

/** Deleting an open instance skips that occurrence: the next one appears at once. */
export function deleteTask(engine: SyncEngine, ws: Workspace, task: Task): void {
  engine.mutate('task', task.id, { deleted: true })
  if (task.status === 'open') spawnNext(engine, ws, task, null)
}

/**
 * Creates the next instance after `task`. On a schedule the next date follows
 * the instance's own date; after completion it follows `completedOn`.
 */
function spawnNext(
  engine: SyncEngine,
  ws: Workspace,
  task: Task,
  completedOn: string | null,
): void {
  const template = task.templateId ? ws.templateById.get(task.templateId) : undefined
  const rule = template?.repeat
  if (!template || !rule) return
  const instanceDate = task.when.kind === 'date' ? task.when.date : ws.today
  const after = rule.basis === 'completion' ? (completedOn ?? ws.today) : instanceDate
  const next = nextOccurrence(rule, after, ws.today)
  if (!next) return
  engine.create('task', instanceOf(template, next, orderAfterSiblings(ws, template, task.id)))
}

function orderAfterSiblings(ws: Workspace, like: Task, exceptId: string): string {
  const siblings = like.projectId
    ? views
        .projectTasks(ws.tasks, like.projectId)
        .filter((s) => s.headingId === like.headingId && s.id !== exceptId)
    : like.areaId
      ? views.areaTasks(ws.tasks, like.areaId).filter((s) => s.id !== exceptId)
      : []
  return orderBetween(siblings.at(-1)?.order ?? like.order, null)
}

/**
 * Gives a task a repeat rule. A plain task becomes the first instance of a new
 * template with the same content; an instance's template gets the new rule and
 * the instance moves to the rule's first date.
 */
export function setRepeat(engine: SyncEngine, ws: Workspace, task: Task, rule: Repeat): void {
  const first = firstOccurrence(rule, ws.today)
  if (!first) return
  const deadline = rule.deadlineDays === null ? null : addDaysTo(first, rule.deadlineDays)
  const existing = task.templateId ? ws.templateById.get(task.templateId) : undefined
  if (existing) {
    engine.mutate('task', existing.id, { repeat: rule })
    engine.mutate('task', task.id, { when: { kind: 'date', date: first }, deadline })
    return
  }
  const template: Task = {
    ...task,
    id: ulid(),
    createdAt: new Date().toISOString(),
    status: 'open',
    completedAt: null,
    when: { kind: 'anytime' },
    deadline: null,
    repeat: rule,
    templateId: null,
    todayOrder: null,
  }
  engine.create('task', template)
  engine.mutate('task', task.id, {
    templateId: template.id,
    when: { kind: 'date', date: first },
    deadline,
  })
}

/** Ends the repetition; the current instance stays as an ordinary task. */
export function stopRepeat(engine: SyncEngine, ws: Workspace, task: Task): void {
  const template = task.templateId ? ws.templateById.get(task.templateId) : undefined
  if (template) engine.mutate('task', template.id, { deleted: true })
  engine.mutate('task', task.id, { templateId: null })
}

function addDaysTo(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return views.toCalendarDate(new Date(y, m - 1, d + days))
}

export function toggleProject(engine: SyncEngine, project: Project): void {
  const completing = project.status === 'open'
  engine.mutate('project', project.id, {
    status: completing ? 'completed' : 'open',
    completedAt: completing ? new Date().toISOString() : null,
  })
}

/** Deletes a project with its headings and tasks, as Things moves all of it to the trash. */
export function deleteProject(engine: SyncEngine, ws: Workspace, project: Project): void {
  for (const task of ws.tasks) {
    if (task.projectId === project.id) engine.mutate('task', task.id, { deleted: true })
  }
  for (const heading of ws.headings) {
    if (heading.projectId === project.id) engine.mutate('heading', heading.id, { deleted: true })
  }
  engine.mutate('project', project.id, { deleted: true })
}

/** Deletes an area with everything in it: its projects (and their tasks) and its loose tasks. */
export function deleteArea(engine: SyncEngine, ws: Workspace, area: Area): void {
  for (const project of ws.projects) {
    if (project.areaId === area.id) deleteProject(engine, ws, project)
  }
  for (const task of ws.tasks) {
    if (task.areaId === area.id && task.projectId === null) {
      engine.mutate('task', task.id, { deleted: true })
    }
  }
  engine.mutate('area', area.id, { deleted: true })
}

/**
 * Moves a task. A task has a project or an area, never both; a heading implies
 * its project. Leaving the Inbox for a container makes the task Anytime.
 */
export function moveTask(engine: SyncEngine, ws: Workspace, task: Task, target: MoveTarget): void {
  commitTask(engine, ws, task, moveFields(ws, task, target))
}

/** The field changes that `moveTask` would make; empty when nothing changes. */
export function moveFields(ws: Workspace, task: Task, target: MoveTarget): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  const leavingInbox = () => {
    if (task.when.kind === 'inbox') fields.when = { kind: 'anytime' } satisfies When
  }
  switch (target.kind) {
    case 'none':
      if (task.projectId === null && task.areaId === null) return fields
      fields.projectId = null
      fields.areaId = null
      fields.headingId = null
      break
    case 'when': {
      const evening = target.evening ?? false
      if (sameWhen(task.when, target.when) && task.evening === evening) return fields
      fields.when = target.when
      fields.evening = evening
      break
    }
    case 'project': {
      const headingId = target.headingId ?? null
      if (task.projectId === target.projectId && task.headingId === headingId) return fields
      fields.projectId = target.projectId
      fields.headingId = headingId
      fields.areaId = null
      const siblings = views
        .projectTasks(ws.tasks, target.projectId)
        .filter((s) => s.headingId === headingId && s.id !== task.id)
      fields.order = orderBetween(siblings.at(-1)?.order ?? null, null)
      leavingInbox()
      break
    }
    case 'area': {
      if (task.areaId === target.areaId && task.projectId === null) return fields
      fields.areaId = target.areaId
      fields.projectId = null
      fields.headingId = null
      const siblings = views.areaTasks(ws.tasks, target.areaId).filter((s) => s.id !== task.id)
      fields.order = orderBetween(siblings.at(-1)?.order ?? null, null)
      leavingInbox()
      break
    }
  }
  return fields
}

function sameWhen(a: When, b: When): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'date' && b.kind === 'date' ? a.date === b.date : true
}

/** Gives `task` the order that puts it between `before` and `after` in a sorted list. */
export function reorder(
  engine: SyncEngine,
  entityType: 'task' | 'project' | 'area' | 'heading',
  id: string,
  before: { order: string } | undefined,
  after: { order: string } | undefined,
): void {
  engine.mutate(entityType, id, {
    order: orderBetween(before?.order ?? null, after?.order ?? null),
  })
}

const LINGER_MS = 1200

/**
 * Tasks that were just checked off stay visible for a moment so the action
 * registers; after that they leave the list. Returns the tasks to show and a
 * toggle that handles the lingering.
 */
export function useLinger(
  visible: Task[],
  ws: Workspace,
  engine: SyncEngine,
  sort: (a: Task, b: Task) => number = views.byOrder,
): { shown: Task[]; toggle: (task: Task) => void } {
  const all = ws.tasks
  const [lingering, setLingering] = useState<Set<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending.values()) clearTimeout(t)
    }
  }, [])

  let shown = visible
  if (lingering.size > 0) {
    const byId = new Map(all.map((t) => [t.id, t]))
    shown = [...visible]
    for (const id of lingering) {
      const current = byId.get(id)
      if (current && !shown.some((t) => t.id === id)) shown.push(current)
    }
    shown.sort(sort)
  }

  function toggle(task: Task) {
    toggleTask(engine, ws, task)
    setLingering((s) => new Set(s).add(task.id))
    const existing = timers.current.get(task.id)
    if (existing) clearTimeout(existing)
    timers.current.set(
      task.id,
      setTimeout(() => {
        timers.current.delete(task.id)
        setLingering((s) => {
          const next = new Set(s)
          next.delete(task.id)
          return next
        })
      }, LINGER_MS),
    )
  }

  return { shown, toggle }
}
