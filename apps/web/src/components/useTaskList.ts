import type { ChecklistItem, Task } from '@dingen/core'
import {
  createElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { setTaskParam, useTaskParam } from '../router.js'
import {
  EMPTY_SELECTION,
  extendSelection,
  nextAfterRemoval,
  pruneSelection,
  type Selection,
  selectOne,
  selectRange,
  toggleInSelection,
} from '../selection.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { deleteTask } from '../taskActions.js'
import { type ClickHow, listKeyAction, rowClickAction } from '../taskPanel.js'
import { type PanelFocus, TaskPanel } from './TaskPanel.js'
import type { RowProps } from './TaskRow.js'

export interface TaskList {
  /** The selected task when exactly one is selected. */
  selected: Task | undefined
  /** Every selected task, top to bottom; the toolbar acts on all of them. */
  selection: Task[]
  /** Selection mode on a touch screen (after a long press): taps add and remove tasks. */
  selecting: boolean
  /** Clears the selection and leaves selection mode. */
  clearSelection: () => void
  /** Deletes every selected task; with more than one it first asks (see `askingDelete`). */
  deleteSelection: (confirmed?: boolean) => void
  /** The toolbar is asking whether to delete the selected tasks. */
  askingDelete: boolean
  cancelDelete: () => void
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
  const [rawSelection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [selecting, setSelecting] = useState(false)
  const [askingDelete, setAskingDelete] = useState(false)
  const [newId, setNewId] = useState<string | null>(null)
  const [focus, setFocus] = useState<PanelFocus | null>(null)
  const engine = useEngine()
  const ws = useWorkspace()
  // The open task stays open when it leaves the list (moved to tomorrow, filtered out), so
  // more fields can be filled in; only deleting or finishing it closes the panel.
  const openTask = param
    ? (tasks.find((t) => t.id === param) ??
      ws.tasks.find((t) => t.id === param && !t.deleted && t.status === 'open'))
    : undefined
  const openId = openTask?.id ?? null

  // Tasks that leave the page (deleted, done and gone, filtered out) leave the selection;
  // the open task counts as present, since it stays open off the list.
  const present = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id))
    if (openId) ids.add(openId)
    return ids
  }, [tasks, openId])
  const sel = pruneSelection(rawSelection, present)
  const selectedId = sel.ids.length === 1 ? (sel.ids[0] ?? null) : sel.focus
  const count = sel.ids.length

  // Selection mode ends when nothing is selected any more; asking to delete ends with fewer
  // than two.
  useEffect(() => {
    if (selecting && count === 0) setSelecting(false)
    if (askingDelete && count < 2) setAskingDelete(false)
  }, [selecting, askingDelete, count])

  /** Applies a new selection; with more than one task selected the panel closes. */
  const applySelection = useCallback(
    (next: Selection) => {
      setSelection(next)
      setAskingDelete(false)
      if (next.ids.length > 1 && openId) setTaskParam(null)
    },
    [openId],
  )

  const clearSelection = useCallback(() => {
    setSelection(EMPTY_SELECTION)
    setSelecting(false)
    setAskingDelete(false)
  }, [])

  const selection = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]))
    if (openTask) byId.set(openTask.id, openTask)
    return sel.ids.map((id) => byId.get(id)).filter((t): t is Task => Boolean(t))
  }, [sel.ids, tasks, openTask])

  const deleteSelection = useCallback(
    (confirmed = false) => {
      if (selection.length === 0) return
      if (selection.length > 1 && !confirmed) {
        setAskingDelete(true)
        return
      }
      const ids = selection.map((t) => t.id)
      const next = selecting ? null : nextAfterRemoval(ids, rowIds())
      if (openId && ids.includes(openId)) setTaskParam(null)
      // One snapshot for all of them; the sync engine pushes the changes together.
      for (const task of selection) deleteTask(engine, ws, task)
      setAskingDelete(false)
      setSelection(selectOne(next))
      if (selecting) setSelecting(false)
    },
    [selection, selecting, openId, engine, ws],
  )

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
    setSelection(selectOne(openId))
    requestAnimationFrame(() => {
      document
        .querySelector(`.content [data-task-id="${openId}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }, [openId])

  // A task that goes while open (deleted, or done and gone from the list) closes the panel
  // and leaves the address bar.
  const hadOpen = useRef<string | null>(null)
  useEffect(() => {
    if (openId) hadOpen.current = openId
    else if (hadOpen.current) {
      if (param === hadOpen.current) setTaskParam(null)
      hadOpen.current = null
    }
  }, [openId, param])

  const open = useCallback((id: string, target: PanelFocus['target'] | null) => {
    setSelection(selectOne(id))
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
        shift: e.shiftKey,
        typing: Boolean(target?.closest('input, textarea, select, [contenteditable="true"]')),
        inPopup: Boolean(popup && popup !== panel),
        inPanel: Boolean(panel && panel !== target),
        onPanel: Boolean(panel && panel === target),
        inList: Boolean(target?.closest('.content [data-task-id]')),
        onButton: Boolean(target?.closest('button, a, [role="button"]')),
        selected: selectedId,
        count,
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
          clearSelection()
          break
        case 'deleteSelection':
          deleteSelection()
          break
        case 'extend': {
          const onRow = target?.closest('.content [data-task-id]')
          const next = extendSelection(sel, action.direction, rowIds())
          if (!next) break
          applySelection(next)
          const row = next.focus ? rowButton(next.focus) : null
          row?.scrollIntoView({ block: 'nearest' })
          if (onRow) row?.focus()
          break
        }
        case 'open':
          open(action.id, 'panel')
          break
        case 'delete': {
          const task = tasks.find((t) => t.id === action.id)
          if (!task) return
          const onRow = target?.closest('.content [data-task-id]')
          if (openId === action.id) setTaskParam(null)
          setSelection(selectOne(action.next))
          deleteTask(engine, ws, task)
          // Focus moves on to the row that is now selected.
          const next = action.next
          if (onRow && next) requestAnimationFrame(() => rowButton(next)?.focus())
          break
        }
        case 'move': {
          const onRow = target?.closest('.content [data-task-id]')
          setSelection(selectOne(action.id))
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
  }, [
    openId,
    selectedId,
    count,
    sel,
    tasks,
    engine,
    ws,
    open,
    close,
    clearSelection,
    deleteSelection,
    applySelection,
  ])

  const openNew = useCallback(
    (id: string) => {
      setNewId(id)
      open(id, 'title')
    },
    [open],
  )

  const selected = count === 1 && selectedId ? tasks.find((t) => t.id === selectedId) : undefined

  const rowProps = (task: Task, extra: Partial<RowProps> = {}): RowProps => ({
    open: openId === task.id,
    selected: sel.ids.includes(task.id),
    selection: count > 1 && sel.ids.includes(task.id) ? selection : undefined,
    showWhen: false,
    showCaption: false,
    onSelect: (how: ClickHow = {}) => {
      const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
      const action = rowClickAction(coarse, Boolean(openId), { ...how, selecting })
      if (action === 'select') setSelection(selectOne(task.id))
      else if (action === 'toggle') {
        // The open task counts as selected, so Cmd-click adds to it.
        const from = openId && count === 0 ? selectOne(openId) : sel
        applySelection(toggleInSelection(from, task.id, rowIds()))
      } else if (action === 'range') applySelection(selectRange(sel, task.id, rowIds()))
      // Switching tasks with the panel open keeps focus in the list, like the arrow keys.
      else open(task.id, openId ? null : 'panel')
    },
    onLongPress: () => {
      // A long press starts selection mode with this task (or adds it when already in it).
      if (openId) setTaskParam(null)
      setSelection((s) =>
        selecting ? toggleInSelection(s, task.id, rowIds()) : selectOne(task.id),
      )
      setSelecting(true)
    },
    onOpen: () => open(task.id, 'panel'),
    onToggle: () => toggle(task),
    ...extra,
  })

  const panel = createElement(TaskPanel, {
    task: openTask,
    focus,
    onClose: close,
    onToggle: toggle,
    onOpen: (id: string) => open(id, 'panel'),
  })

  return {
    selected,
    selection,
    selecting,
    clearSelection,
    deleteSelection,
    askingDelete,
    cancelDelete: () => setAskingDelete(false),
    rowProps,
    openNew,
    panel,
  }
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
