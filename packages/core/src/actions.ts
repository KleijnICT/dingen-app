import { addDays } from './dates.js'
import type {
  Area,
  ChecklistItem,
  Entity,
  EntityType,
  Heading,
  Project,
  Repeat,
  Tag,
  Task,
  When,
} from './entities.js'
import { newChecklistItem } from './factories.js'
import { ulid } from './ids.js'
import { orderBetween } from './order.js'
import {
  checklistMirror,
  firstOccurrence,
  instanceChecklist,
  instanceOf,
  nextOccurrence,
} from './repeat.js'
import * as views from './views.js'

/**
 * De handelingen van Dingen als pure stappen op een momentopname: afvinken
 * (met het volgende exemplaar), verplaatsen, herhaling instellen, verwijderen.
 * Web en MCP gebruiken dezelfde code; alleen de `Writer` verschilt.
 */

/** Wie de wijzigingen wegschrijft: de sync-engine van de browser, of de MCP-client. */
export interface Writer {
  create(entityType: EntityType, entity: Entity): void
  mutate(entityType: EntityType, entityId: string, fields: Record<string, unknown>): void
}

/** Alles wat de handelingen moeten weten; verwijderde entiteiten zijn er al uit. */
export interface Snapshot {
  today: string
  tasks: Task[]
  projects: Project[]
  areas: Area[]
  headings: Heading[]
  tags: Tag[]
  templateById: Map<string, Task>
  checklistByTask: Map<string, ChecklistItem[]>
}

export function buildSnapshot(
  today: string,
  e: {
    tasks: Task[]
    projects: Project[]
    areas: Area[]
    headings: Heading[]
    tags: Tag[]
    checklist: ChecklistItem[]
  },
): Snapshot {
  const checklistByTask = new Map<string, ChecklistItem[]>()
  for (const item of e.checklist) {
    checklistByTask.set(item.taskId, [...(checklistByTask.get(item.taskId) ?? []), item])
  }
  for (const items of checklistByTask.values()) items.sort(views.byOrder)
  return {
    today,
    tasks: e.tasks,
    projects: e.projects,
    areas: e.areas,
    headings: e.headings,
    tags: e.tags,
    templateById: new Map(e.tasks.filter((t) => t.repeat !== null).map((t) => [t.id, t])),
    checklistByTask,
  }
}

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
  w: Writer,
  ws: Snapshot,
  task: Task,
  fields: Record<string, unknown>,
): void {
  if (Object.keys(fields).length === 0) return
  w.mutate('task', task.id, fields)
  const template = task.templateId ? ws.templateById.get(task.templateId) : undefined
  if (!template || task.status !== 'open') return
  const mirrored = Object.fromEntries(Object.entries(fields).filter(([k]) => MIRRORED.has(k)))
  if (Object.keys(mirrored).length > 0) w.mutate('task', template.id, mirrored)
}

export function toggleTask(w: Writer, ws: Snapshot, task: Task): void {
  const completing = task.status === 'open'
  w.mutate('task', task.id, {
    status: completing ? 'completed' : 'open',
    completedAt: completing ? new Date().toISOString() : null,
  })
  if (completing) spawnNext(w, ws, task, ws.today)
}

/** Deleting an open instance skips that occurrence: the next one appears at once. */
export function deleteTask(w: Writer, ws: Snapshot, task: Task): void {
  w.mutate('task', task.id, { deleted: true })
  if (task.status === 'open') spawnNext(w, ws, task, null)
}

/**
 * Creates the next instance after `task`. On a schedule the next date follows
 * the instance's own date; after completion it follows `completedOn`.
 */
function spawnNext(w: Writer, ws: Snapshot, task: Task, completedOn: string | null): void {
  const template = task.templateId ? ws.templateById.get(task.templateId) : undefined
  const rule = template?.repeat
  if (!template || !rule) return
  const instanceDate = task.when.kind === 'date' ? task.when.date : ws.today
  const after = rule.basis === 'completion' ? (completedOn ?? ws.today) : instanceDate
  const next = nextOccurrence(rule, after, ws.today)
  if (!next) return
  const instance = instanceOf(template, next, orderAfterSiblings(ws, template, task.id))
  w.create('task', instance)
  const items = instanceChecklist(ws.checklistByTask.get(template.id) ?? [], instance.id)
  for (const item of items) w.create('checklistItem', item)
}

/**
 * After a change to an open instance's checklist, makes the template's
 * checklist match it (matched by position; ticks are not copied).
 * `nextItems` is the instance's checklist as it is after the change.
 */
export function mirrorChecklist(
  w: Writer,
  ws: Snapshot,
  task: Task,
  nextItems: ChecklistItem[],
): void {
  const template = task.templateId ? ws.templateById.get(task.templateId) : undefined
  if (!template || task.status !== 'open') return
  const plan = checklistMirror(ws.checklistByTask.get(template.id) ?? [], nextItems)
  for (const u of plan.update) w.mutate('checklistItem', u.id, u.fields)
  for (const c of plan.create) {
    w.create('checklistItem', newChecklistItem({ ...c, taskId: template.id }))
  }
  for (const id of plan.remove) w.mutate('checklistItem', id, { deleted: true })
}

function orderAfterSiblings(ws: Snapshot, like: Task, exceptId: string): string {
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
export function setRepeat(w: Writer, ws: Snapshot, task: Task, rule: Repeat): void {
  const first = firstOccurrence(rule, ws.today)
  if (!first) return
  const deadline = rule.deadlineDays === null ? null : addDays(first, rule.deadlineDays)
  const existing = task.templateId ? ws.templateById.get(task.templateId) : undefined
  if (existing) {
    w.mutate('task', existing.id, { repeat: rule })
    w.mutate('task', task.id, { when: { kind: 'date', date: first }, deadline })
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
  w.create('task', template)
  for (const item of instanceChecklist(ws.checklistByTask.get(task.id) ?? [], template.id)) {
    w.create('checklistItem', item)
  }
  w.mutate('task', task.id, {
    templateId: template.id,
    when: { kind: 'date', date: first },
    deadline,
  })
}

/** Ends the repetition; the current instance stays as an ordinary task. */
export function stopRepeat(w: Writer, ws: Snapshot, task: Task): void {
  const template = task.templateId ? ws.templateById.get(task.templateId) : undefined
  if (template) w.mutate('task', template.id, { deleted: true })
  w.mutate('task', task.id, { templateId: null })
}

export function toggleProject(w: Writer, project: Project): void {
  const completing = project.status === 'open'
  w.mutate('project', project.id, {
    status: completing ? 'completed' : 'open',
    completedAt: completing ? new Date().toISOString() : null,
  })
}

/** Deletes a project with its headings and tasks, as Things moves all of it to the trash. */
export function deleteProject(w: Writer, ws: Snapshot, project: Project): void {
  for (const task of ws.tasks) {
    if (task.projectId === project.id) w.mutate('task', task.id, { deleted: true })
  }
  for (const heading of ws.headings) {
    if (heading.projectId === project.id) w.mutate('heading', heading.id, { deleted: true })
  }
  w.mutate('project', project.id, { deleted: true })
}

/** Deletes an area with everything in it: its projects (and their tasks) and its loose tasks. */
export function deleteArea(w: Writer, ws: Snapshot, area: Area): void {
  for (const project of ws.projects) {
    if (project.areaId === area.id) deleteProject(w, ws, project)
  }
  for (const task of ws.tasks) {
    if (task.areaId === area.id && task.projectId === null) {
      w.mutate('task', task.id, { deleted: true })
    }
  }
  w.mutate('area', area.id, { deleted: true })
}

/**
 * Moves a task. A task has a project or an area, never both; a heading implies
 * its project. Leaving the Inbox for a container makes the task Anytime.
 */
export function moveTask(w: Writer, ws: Snapshot, task: Task, target: MoveTarget): void {
  commitTask(w, ws, task, moveFields(ws, task, target))
}

/** The field changes that `moveTask` would make; empty when nothing changes. */
export function moveFields(ws: Snapshot, task: Task, target: MoveTarget): Record<string, unknown> {
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
