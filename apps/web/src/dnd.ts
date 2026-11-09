import type { Area, ChecklistItem, Project, Task } from '@dingen/core'
import { orderBetween, views } from '@dingen/core'
import type { DragEndEvent } from '@dnd-kit/core'
import type { ListId } from './lists.js'
import type { Workspace } from './store/context.js'
import type { SyncEngine } from './store/engine.js'
import { commitTask, type MoveTarget, mirrorChecklist, moveFields } from './taskActions.js'

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
}

function orderKey(group: TaskGroupInfo): (task: Task) => string {
  return group.orderField === 'todayOrder' ? views.todayKey : (task) => task.order
}

export type DragData =
  | { type: 'task'; task: Task; group: TaskGroupInfo; siblings: Task[] }
  | { type: 'project'; project: Project }
  | { type: 'area'; area: Area }
  | { type: 'checklistItem'; item: ChecklistItem; task: Task; siblings: ChecklistItem[] }

export type DropData =
  | DragData
  | { type: 'group'; group: TaskGroupInfo; siblings: Task[] }
  | { type: 'list'; listId: ListId }

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
  const before = below ? siblings[index] : siblings[index - 1]
  const after = below ? siblings[index + 1] : siblings[index]
  const order = orderBetween(before?.order ?? null, after?.order ?? null)
  engine.mutate('checklistItem', active.item.id, { order })
  const moved = { ...active.item, order }
  mirrorChecklist(engine, ws, active.task, [...siblings, moved])
}

function dropTask(
  engine: SyncEngine,
  ws: Workspace,
  active: Extract<DragData, { type: 'task' }>,
  over: DropData,
  below: boolean,
): void {
  const task = active.task
  switch (over.type) {
    case 'list': {
      const target = listTarget(over.listId, ws.today)
      if (target) commitTask(engine, ws, task, moveFields(ws, task, target))
      return
    }
    case 'project':
      commitTask(
        engine,
        ws,
        task,
        moveFields(ws, task, { kind: 'project', projectId: over.project.id }),
      )
      return
    case 'area':
      commitTask(engine, ws, task, moveFields(ws, task, { kind: 'area', areaId: over.area.id }))
      return
    case 'group': {
      const siblings = over.siblings.filter((s) => s.id !== task.id)
      const fields = over.group.key === active.group.key ? {} : targetFields(ws, task, over.group)
      const key = orderKey(over.group)
      const last = siblings.at(-1)
      fields[over.group.orderField ?? 'order'] = orderBetween(last ? key(last) : null, null)
      commitTask(engine, ws, task, fields)
      return
    }
    case 'task': {
      const siblings = over.siblings.filter((s) => s.id !== task.id)
      const index = siblings.findIndex((s) => s.id === over.task.id)
      if (index < 0) return
      const before = below ? siblings[index] : siblings[index - 1]
      const after = below ? siblings[index + 1] : siblings[index]
      const fields = over.group.key === active.group.key ? {} : targetFields(ws, task, over.group)
      const key = orderKey(over.group)
      fields[over.group.orderField ?? 'order'] = orderBetween(
        before ? key(before) : null,
        after ? key(after) : null,
      )
      commitTask(engine, ws, task, fields)
      return
    }
  }
}

function targetFields(ws: Workspace, task: Task, group: TaskGroupInfo): Record<string, unknown> {
  return group.target ? moveFields(ws, task, group.target) : {}
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
  const before = below ? siblings[index] : siblings[index - 1]
  const after = below ? siblings[index + 1] : siblings[index]
  engine.mutate('project', project.id, {
    areaId: over.project.areaId,
    order: orderBetween(before?.order ?? null, after?.order ?? null),
  })
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
  const before = below ? siblings[index] : siblings[index - 1]
  const after = below ? siblings[index + 1] : siblings[index]
  engine.mutate('area', area.id, {
    order: orderBetween(before?.order ?? null, after?.order ?? null),
  })
}
