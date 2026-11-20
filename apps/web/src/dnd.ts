import type { Area, ChecklistItem, Daypart, Project, Task } from '@dingen/core'
import { orderBetween, ordersBetween, placeAt, placeBlockAt, views } from '@dingen/core'
import type { DragEndEvent } from '@dnd-kit/core'
import type { ListId } from './lists.js'
import type { Workspace } from './store/context.js'
import type { SyncEngine } from './store/engine.js'
import {
  batchFields,
  commitTask,
  type MoveTarget,
  mirrorChecklist,
  moveFields,
  moveTasks,
} from './taskActions.js'

/**
 * Drag and drop in one place. Every draggable or droppable element carries
 * one of these as `data`; `handleDragEnd` turns a pair into field changes.
 */

export interface TaskGroupInfo {
  /** Distinguishes groups on a page; same key means "reorder only". */
  key: string
  /** What landing in this group means; null when the group is only an order. */
  target: MoveTarget | null
  /** Which order the group is sorted by; Today has its own. */
  orderField?: 'order' | 'todayOrder'
  /**
   * Landing here also plans the task for today in this daypart (null: none);
   * Today by project has a group per project within each daypart.
   */
  daypart?: Daypart | null | undefined
}

function orderKey(group: TaskGroupInfo): (task: Task) => string {
  return group.orderField === 'todayOrder' ? views.todayKey : (task) => task.order
}

export type DragData =
  | {
      type: 'task'
      task: Task
      group: TaskGroupInfo
      siblings: Task[]
      /** The page's selection when this task is part of it: dragging it carries them all. */
      selection?: readonly Task[] | undefined
    }
  | { type: 'project'; project: Project }
  | { type: 'area'; area: Area }
  | { type: 'checklistItem'; item: ChecklistItem; task: Task; siblings: ChecklistItem[] }

export type DropData =
  | DragData
  | { type: 'group'; group: TaskGroupInfo; siblings: Task[] }
  | { type: 'list'; listId: ListId }

/**
 * The tasks a drag carries, top to bottom: the whole selection when the dragged task is part
 * of it (the open ones, like the toolbar, and the dragged one itself), otherwise just that task.
 */
export function draggedTasks(task: Task, selection: readonly Task[] | undefined): Task[] {
  if (!selection?.some((s) => s.id === task.id)) return [task]
  return selection.filter((s) => s.id === task.id || s.status === 'open')
}

/**
 * Where a block of dragged tasks lands among `siblings` (the rows of the group, the dragged
 * ones included): its index among the siblings that stay, just above or below the row it was
 * dropped on. Null when that row is not in the group.
 */
export function blockIndex(
  siblings: readonly { id: string }[],
  overId: string,
  moving: ReadonlySet<string>,
  below: boolean,
): number | null {
  const at = siblings.findIndex((s) => s.id === overId)
  if (at < 0) return null
  return siblings.slice(0, below ? at + 1 : at).filter((s) => !moving.has(s.id)).length
}

export function handleDragEnd(engine: SyncEngine, ws: Workspace, event: DragEndEvent): void {
  const active = event.active.data.current as DragData | undefined
  const over = event.over?.data.current as DropData | undefined
  if (!active || !over || event.active.id === event.over?.id) return

  // Where the dragged item's centre ended up relative to the target's centre.
  const activeRect = event.active.rect.current.translated
  const overRect = event.over?.rect
  const below =
    activeRect && overRect
      ? activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
      : false

  if (active.type === 'task') dropTask(engine, ws, active, over, below)
  else if (active.type === 'project') dropProject(engine, ws, active.project, over, below)
  else if (active.type === 'area') dropArea(engine, ws, active.area, over, below)
  else if (active.type === 'checklistItem') dropChecklistItem(engine, ws, active, over, below)
}

function dropChecklistItem(
  engine: SyncEngine,
  ws: Workspace,
  active: Extract<DragData, { type: 'checklistItem' }>,
  over: DropData,
  below: boolean,
): void {
  if (over.type !== 'checklistItem' || over.task.id !== active.task.id) return
  const siblings = active.siblings.filter((i) => i.id !== active.item.id)
  const index = siblings.findIndex((i) => i.id === over.item.id)
  if (index < 0) return
  const { order, renumber } = placeAt(siblings, below ? index + 1 : index, (i) => i.order)
  for (const [id, o] of renumber) engine.mutate('checklistItem', id, { order: o })
  engine.mutate('checklistItem', active.item.id, { order })
  const moved = { ...active.item, order }
  const rest = siblings.map((i) => ({ ...i, order: renumber.get(i.id) ?? i.order }))
  mirrorChecklist(engine, ws, active.task, [...rest, moved])
}

function dropTask(
  engine: SyncEngine,
  ws: Workspace,
  active: Extract<DragData, { type: 'task' }>,
  over: DropData,
  below: boolean,
): void {
  const tasks = draggedTasks(active.task, active.selection)
  const moving = new Set(tasks.map((t) => t.id))
  switch (over.type) {
    case 'list': {
      const target = listTarget(over.listId, ws.today)
      if (target) moveTasks(engine, ws, tasks, target)
      return
    }
    case 'project':
      moveTasks(engine, ws, tasks, { kind: 'project', projectId: over.project.id })
      return
    case 'area':
      moveTasks(engine, ws, tasks, { kind: 'area', areaId: over.area.id })
      return
    case 'group': {
      const last = over.siblings.filter((s) => !moving.has(s.id)).at(-1)
      const key = orderKey(over.group)
      const orders = ordersBetween(last ? key(last) : null, null, tasks.length)
      landTasks(engine, ws, active, tasks, over, orders)
      return
    }
    case 'task': {
      const index = blockIndex(over.siblings, over.task.id, moving, below)
      if (index === null) return
      const siblings = over.siblings.filter((s) => !moving.has(s.id))
      const field = over.group.orderField ?? 'order'
      const { orders, renumber } = placeBlockAt(siblings, index, tasks.length, orderKey(over.group))
      for (const [id, o] of renumber) engine.mutate('task', id, { [field]: o })
      landTasks(engine, ws, active, tasks, over, orders)
      return
    }
  }
}

/**
 * Lands dragged tasks in a group with the given orders: tasks from elsewhere also take on
 * what the group means (its project, area, date or daypart); tasks already in it only move.
 */
function landTasks(
  engine: SyncEngine,
  ws: Workspace,
  active: Extract<DragData, { type: 'task' }>,
  tasks: readonly Task[],
  over: { group: TaskGroupInfo; siblings: Task[] },
  orders: readonly string[],
): void {
  const inGroup = new Set(over.siblings.map((s) => s.id))
  if (over.group.key === active.group.key) inGroup.add(active.task.id)
  const field = over.group.orderField ?? 'order'
  const changes = batchFields(tasks, (task, i) => {
    const fields = inGroup.has(task.id) ? {} : targetFields(ws, task, over.group)
    fields[field] = orders[i]
    return fields
  })
  for (const { task, fields } of changes) commitTask(engine, ws, task, fields)
}

function targetFields(ws: Workspace, task: Task, group: TaskGroupInfo): Record<string, unknown> {
  const fields = group.target ? moveFields(ws, task, group.target) : {}
  if (group.daypart === undefined) return fields
  const moved = { ...task, ...fields } as Task
  return {
    ...fields,
    ...moveFields(ws, moved, {
      kind: 'when',
      when: { kind: 'date', date: ws.today },
      daypart: group.daypart,
    }),
  }
}

export function listTarget(listId: ListId, today: string): MoveTarget | null {
  switch (listId) {
    case 'inbox':
      return { kind: 'when', when: { kind: 'inbox' } }
    case 'today':
      return { kind: 'when', when: { kind: 'date', date: today } }
    case 'anytime':
      return { kind: 'when', when: { kind: 'anytime' } }
    case 'someday':
      return { kind: 'when', when: { kind: 'someday' } }
    default:
      return null
  }
}

function dropProject(
  engine: SyncEngine,
  ws: Workspace,
  project: Project,
  over: DropData,
  below: boolean,
): void {
  if (over.type === 'area') {
    if (project.areaId === over.area.id) return
    const last = views.projectsOf(ws.projects, over.area.id).at(-1)
    engine.mutate('project', project.id, {
      areaId: over.area.id,
      order: orderBetween(last?.order ?? null, null),
    })
    return
  }
  if (over.type !== 'project') return
  const siblings = views
    .projectsOf(ws.projects, over.project.areaId)
    .filter((p) => p.id !== project.id)
  const index = siblings.findIndex((p) => p.id === over.project.id)
  if (index < 0) return
  const { order, renumber } = placeAt(siblings, below ? index + 1 : index, (p) => p.order)
  for (const [id, o] of renumber) engine.mutate('project', id, { order: o })
  engine.mutate('project', project.id, { areaId: over.project.areaId, order })
}

function dropArea(
  engine: SyncEngine,
  ws: Workspace,
  area: Area,
  over: DropData,
  below: boolean,
): void {
  if (over.type !== 'area') return
  const siblings = views.openAreas(ws.areas).filter((a) => a.id !== area.id)
  const index = siblings.findIndex((a) => a.id === over.area.id)
  if (index < 0) return
  const { order, renumber } = placeAt(siblings, below ? index + 1 : index, (a) => a.order)
  for (const [id, o] of renumber) engine.mutate('area', id, { order: o })
  engine.mutate('area', area.id, { order })
}
