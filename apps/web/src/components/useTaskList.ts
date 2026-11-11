import type { ChecklistItem, Task } from '@dingen/core'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useEngine, useWorkspace } from '../store/context.js'
import { deleteTask } from '../taskActions.js'
import type { RowProps } from './TaskRow.js'

/*
 * Selection asked for from outside a page (search): the page that shows the
 * task picks it up, selects it and scrolls to it.
 */
let requested: string | null = null
const listeners = new Set<() => void>()

export function requestSelect(taskId: string): void {
  requested = taskId
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Touch screens open a task with one tap; with a mouse one click selects it. */
const coarse = () => window.matchMedia?.('(pointer: coarse)').matches ?? false

export interface TaskList {
  selected: Task | undefined
  rowProps: (task: Task, extra?: Partial<RowProps>) => RowProps
  /** Opens a freshly created task in the editor; it is removed again if left empty. */
  openNew: (id: string) => void
}

/**
 * Which task is selected, which one is open and which one was just created,
 * for one page. `tasks` is every task the page can show.
 */
export function useTaskList(tasks: Task[], toggle: (task: Task) => void): TaskList {
  const [openId, setOpenId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newId, setNewId] = useState<string | null>(null)
  const wanted = useSyncExternalStore(subscribe, () => requested)
  const engine = useEngine()
  const ws = useWorkspace()

  // A new task that is closed without a title, notes or checklist was never
  // meant; it goes away. Read from the engine: the snapshot may lag a render.
  useEffect(() => {
    if (!newId || openId === newId) return
    setNewId(null)
    const task = (engine.entities('task') as Task[]).find((t) => t.id === newId)
    if (!task || task.title.trim() || task.notes.trim()) return
    const items = (engine.entities('checklistItem') as ChecklistItem[]).filter(
      (i) => i.taskId === newId,
    )
    if (items.length === 0) deleteTask(engine, ws, task)
  }, [openId, newId, engine, ws])

  useEffect(() => {
    if (!wanted || !tasks.some((t) => t.id === wanted)) return
    requested = null
    setSelectedId(wanted)
    setOpenId(null)
    requestAnimationFrame(() => {
      document.querySelector(`[data-task-id="${wanted}"]`)?.scrollIntoView({ block: 'center' })
    })
  }, [wanted, tasks])

  // Arrow keys move the selection through the rows as they appear on screen;
  // Enter opens it and Escape clears it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [role="dialog"], [role="menu"]')) return
      if (openId || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' && selectedId) {
        setSelectedId(null)
        return
      }
      if (e.key === 'Enter' && selectedId) {
        e.preventDefault()
        setOpenId(selectedId)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const ids = [...document.querySelectorAll<HTMLElement>('.content [data-task-id]')]
        .map((el) => el.dataset.taskId as string)
        .filter(Boolean)
      if (ids.length === 0) return
      e.preventDefault()
      const at = selectedId ? ids.indexOf(selectedId) : -1
      const next =
        e.key === 'ArrowDown' ? ids[Math.min(ids.length - 1, at + 1)] : ids[Math.max(0, at - 1)]
      if (next) {
        setSelectedId(next)
        document.querySelector(`[data-task-id="${next}"]`)?.scrollIntoView({ block: 'nearest' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openId, selectedId])

  const openNew = useCallback((id: string) => {
    setNewId(id)
    setSelectedId(id)
    setOpenId(id)
  }, [])

  const selected = selectedId ? tasks.find((t) => t.id === selectedId) : undefined

  const rowProps = (task: Task, extra: Partial<RowProps> = {}): RowProps => ({
    open: openId === task.id,
    selected: selectedId === task.id,
    showWhen: false,
    showCaption: false,
    onSelect: () => {
      setOpenId(coarse() ? task.id : null)
      setSelectedId(task.id)
    },
    onOpen: () => {
      setSelectedId(task.id)
      setOpenId(task.id)
    },
    onClose: () => setOpenId(null),
    onToggle: () => toggle(task),
    ...extra,
  })

  return { selected, rowProps, openNew }
}

/**
 * Runs `fn` each time `signal` changes after the page mounted (the `n` key
 * bumps it in the shell), but not for the value it mounted with.
 */
export function useOnSignal(signal: number, fn: () => void): void {
  const seen = useRef(signal)
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    if (signal === seen.current) return
    seen.current = signal
    latest.current()
  }, [signal])
}
