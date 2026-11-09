import { type Snapshot, type Task, views, type Writer } from '@dingen/core'
import { useEffect, useRef, useState } from 'react'

export {
  commitTask,
  deleteArea,
  deleteProject,
  deleteTask,
  type MoveTarget,
  mirrorChecklist,
  moveFields,
  moveTask,
  setRepeat,
  stopRepeat,
  toggleProject,
  toggleTask,
} from '@dingen/core'

import { orderBetween, toggleTask } from '@dingen/core'

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
