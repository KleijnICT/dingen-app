import { type Snapshot, type Task, views, type Writer } from '@dingen/core'
import { useEffect, useRef, useState } from 'react'

export {
  commitTask,
  deleteArea,
  deleteProject,
  deleteTask,
  duplicateTask,
  type MoveTarget,
  mirrorChecklist,
  moveFields,
  moveTask,
  setRepeat,
  stopRepeat,
  toggleProject,
  toggleTask,
} from '@dingen/core'

import { convertTaskToProject, newTask, orderBetween, toggleTask } from '@dingen/core'
import { navigate, projectPath } from './router.js'

export { whenFields } from './dayparts.js'

/** Turns `task` into a project (see `convertTaskToProject`) and opens the project's page. */
export function convertToProject(engine: Writer, ws: Snapshot, task: Task): void {
  navigate(projectPath(convertTaskToProject(engine, ws, task).id))
}

/** Gives `task` the order that puts it between `before` and `after` in a sorted list. */
export function reorder(
  engine: Writer,
  entityType: 'task' | 'project' | 'area' | 'heading',
  id: string,
  before: { order: string } | undefined,
  after: { order: string } | undefined,
): void {
  engine.mutate(entityType, id, {
    order: orderBetween(before?.order ?? null, after?.order ?? null),
  })
}

/**
 * A new, empty task, always in the Inbox wherever it was made: after the last task there, with
 * the tag of the active tag filter. Filling in List or When in the panel moves it on.
 */
export function newInboxTask(ws: Pick<Snapshot, 'tasks'>, tagId: string | null = null): Task {
  const last = views.inbox(ws.tasks).at(-1)
  return newTask({
    title: '',
    when: { kind: 'inbox' },
    tagIds: tagId ? [tagId] : [],
    order: orderBetween(last?.order ?? null, null),
  })
}

/** Creates a new, empty task in the Inbox (see `newInboxTask`) and returns it. */
export function createInboxTask(engine: Writer, ws: Snapshot, tagId: string | null = null): Task {
  const task = newInboxTask(ws, tagId)
  engine.create('task', task)
  return task
}

/**
 * The Inbox while you work through it: a task that gets processed (a list and a When) stays
 * where it was until you leave, so it does not jump away under your hands. `scope` names the
 * visit; a new scope starts over. Returns the tasks to show and which of them are processed.
 */
export function useKeepProcessed(
  visible: Task[],
  all: Task[],
  scope: string,
): { shown: Task[]; processed: Set<string> } {
  // Where each task stood while it was in the list (its order then).
  const seen = useRef({ scope, order: new Map<string, string>() })
  if (seen.current.scope !== scope) seen.current = { scope, order: new Map() }
  const order = seen.current.order
  for (const task of visible) order.set(task.id, task.order)
  const ids = new Set(visible.map((task) => task.id))
  const processed = new Set<string>()
  const kept = all.filter((task) => {
    if (ids.has(task.id) || !order.has(task.id) || task.deleted || task.status !== 'open') {
      return false
    }
    processed.add(task.id)
    return true
  })
  if (kept.length === 0) return { shown: visible, processed }
  const key = (task: Task) => order.get(task.id) ?? task.order
  const shown = [...visible, ...kept].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id.localeCompare(b.id),
  )
  return { shown, processed }
}

const LINGER_MS = 1200

/**
 * Tasks that were just checked off stay visible for a moment so the action
 * registers; after that they leave the list. Returns the tasks to show and a
 * toggle that handles the lingering.
 */
export function useLinger(
  visible: Task[],
  ws: Snapshot,
  engine: Writer,
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
