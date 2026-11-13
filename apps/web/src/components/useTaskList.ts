import type { ChecklistItem, Task } from '@dingen/core'
import { createElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { setTaskParam, useTaskParam } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { deleteTask } from '../taskActions.js'
import { listKeyAction } from '../taskPanel.js'
import { type PanelFocus, TaskPanel } from './TaskPanel.js'
import type { RowProps } from './TaskRow.js'

export interface TaskList {
  selected: Task | undefined
  rowProps: (task: Task, extra?: Partial<RowProps>) => RowProps
  /** Opens a freshly created task in the panel; it is removed again if left empty. */
  openNew: (id: string) => void
  /** The detail panel for the open task; render it once on the page. */
  panel: ReactNode
}

/** The task ids of the rows on screen, top to bottom. */
const rowIds = () =>
  [...document.querySelectorAll<HTMLElement>('.content [data-task-id]')]
    .map((el) => el.dataset.taskId as string)
    .filter(Boolean)

const rowButton = (id: string) =>
  document.querySelector<HTMLElement>(`.content [data-task-id="${id}"] .task-main`)

/**
 * Which task is selected, which one is open in the panel and which one was just created, for
 * one page. `tasks` is every task the page can show. The open task lives in the address bar
 * (`?task=`), so it survives a reload and Search can open one.
 */
export function useTaskList(tasks: Task[], toggle: (task: Task) => void): TaskList {
  const param = useTaskParam()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newId, setNewId] = useState<string | null>(null)
  const [focus, setFocus] = useState<PanelFocus | null>(null)
  const engine = useEngine()
  const ws = useWorkspace()
  const openTask = param ? tasks.find((t) => t.id === param) : undefined
  const openId = openTask?.id ?? null

  // A new task that is closed without a title, notes or checklist was never
  // meant; it goes away. Read from the engine: the snapshot may lag a render.
  useEffect(() => {
    if (!newId || param === newId) return
    setNewId(null)
    const task = (engine.entities('task') as Task[]).find((t) => t.id === newId)
    if (!task || task.title.trim() || task.notes.trim()) return
    const items = (engine.entities('checklistItem') as ChecklistItem[]).filter(
      (i) => i.taskId === newId,
    )
    if (items.length === 0) deleteTask(engine, ws, task)
  }, [param, newId, engine, ws])

  // The open task is the selected one; when it arrives from the address bar (a reload,
  // Search) the list scrolls to it.
  useEffect(() => {
    if (!openId) return
    setSelectedId(openId)
    requestAnimationFrame(() => {
      document
        .querySelector(`.content [data-task-id="${openId}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }, [openId])

  // A task that leaves the list while open (moved elsewhere, deleted, done and gone) closes
  // the panel and leaves the address bar.
  const hadOpen = useRef<string | null>(null)
  useEffect(() => {
    if (openId) hadOpen.current = openId
    else if (hadOpen.current) {
      if (param === hadOpen.current) setTaskParam(null)
      hadOpen.current = null
    }
  }, [openId, param])

  const open = useCallback((id: string, target: PanelFocus['target'] | null) => {
    setSelectedId(id)
    setTaskParam(id)
    if (target) setFocus((f) => ({ target, n: (f?.n ?? 0) + 1 }))
  }, [])

  const closeRef = useRef<() => void>(() => {})
  const close = useCallback(() => closeRef.current(), [])
  closeRef.current = () => {
    const id = openId
    const active = document.activeElement as HTMLElement | null
    const fromPanel = !active || active === document.body || active.closest('.task-panel')
    // Blurring saves a title or notes being typed.
    if (active?.closest('.task-panel')) active.blur()
    setTaskParam(null)
    // Back to the row, unless something else (a new task) took focus in the meantime.
    if (id && fromPanel) {
      requestAnimationFrame(() => {
        const now = document.activeElement
        if (!now || now === document.body) rowButton(id)?.focus()
      })
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      const target = e.target instanceof HTMLElement ? e.target : null
      const panel = target?.closest('.task-panel') ?? null
      const popup = target?.closest('[role="dialog"], [role="menu"]')
      const action = listKeyAction({
        key: e.key,
        modified: e.metaKey || e.ctrlKey || e.altKey,
        typing: Boolean(target?.closest('input, textarea, select, [contenteditable="true"]')),
        inPopup: Boolean(popup && popup !== panel),
        inPanel: Boolean(panel && panel !== target),
        onPanel: Boolean(panel && panel === target),
        inList: Boolean(target?.closest('.content [data-task-id]')),
        onButton: Boolean(target?.closest('button, a, [role="button"]')),
        selected: selectedId,
        open: openId,
        ids: rowIds(),
      })
      if (!action) return
      e.preventDefault()
      switch (action.kind) {
        case 'close':
          close()
          break
        case 'deselect':
          setSelectedId(null)
          break
        case 'open':
          open(action.id, 'panel')
          break
        case 'delete': {
          const task = tasks.find((t) => t.id === action.id)
          if (!task) return
          const onRow = target?.closest('.content [data-task-id]')
          if (openId === action.id) setTaskParam(null)
          setSelectedId(action.next)
          deleteTask(engine, ws, task)
          // Focus moves on to the row that is now selected.
          const next = action.next
          if (onRow && next) requestAnimationFrame(() => rowButton(next)?.focus())
          break
        }
        case 'move': {
          const onRow = target?.closest('.content [data-task-id]')
          setSelectedId(action.id)
          if (openId && tasks.some((t) => t.id === action.id)) setTaskParam(action.id)
          const row = rowButton(action.id)
          row?.scrollIntoView({ block: 'nearest' })
          if (onRow) row?.focus()
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openId, selectedId, tasks, engine, ws, open, close])

  const openNew = useCallback(
    (id: string) => {
      setNewId(id)
      open(id, 'title')
    },
    [open],
  )

  const selected = selectedId ? tasks.find((t) => t.id === selectedId) : undefined

  const rowProps = (task: Task, extra: Partial<RowProps> = {}): RowProps => ({
    open: openId === task.id,
    selected: selectedId === task.id,
    showWhen: false,
    showCaption: false,
    onSelect: () => open(task.id, 'panel'),
    onToggle: () => toggle(task),
    ...extra,
  })

  const panel = createElement(TaskPanel, {
    task: openTask,
    focus,
    onClose: close,
    onToggle: toggle,
  })

  return { selected, rowProps, openNew, panel }
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
