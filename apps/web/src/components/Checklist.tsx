import { type ChecklistItem, newChecklistItem, orderBetween, type Task } from '@dingen/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { DragData } from '../dnd.js'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { mirrorChecklist } from '../taskActions.js'
import { CheckIcon } from './Icons.js'

interface Props {
  task: Task
}

/** The checklist inside a task editor: tick, title, remove; Enter adds the next item. */
export function Checklist({ task }: Props) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
  const items = ws.checklistByTask.get(task.id) ?? []
  const [focusId, setFocusId] = useState<string | null>(null)

  function add(after?: ChecklistItem) {
    const index = after ? items.indexOf(after) : items.length - 1
    const before = items[index]
    const next = items[index + 1]
    const item = newChecklistItem({
      title: '',
      taskId: task.id,
      order: orderBetween(before?.order ?? null, next?.order ?? null),
    })
    engine.create('checklistItem', item)
    setFocusId(item.id)
    mirrorChecklist(engine, ws, task, [...items, item])
  }

  function rename(item: ChecklistItem, title: string) {
    engine.mutate('checklistItem', item.id, { title })
    mirrorChecklist(
      engine,
      ws,
      task,
      items.map((i) => (i.id === item.id ? { ...i, title } : i)),
    )
  }

  function toggle(item: ChecklistItem) {
    engine.mutate('checklistItem', item.id, { done: !item.done })
  }

  function remove(item: ChecklistItem, focusPrevious = false) {
    const index = items.indexOf(item)
    engine.mutate('checklistItem', item.id, { deleted: true })
    if (focusPrevious) setFocusId(items[index - 1]?.id ?? null)
    mirrorChecklist(
      engine,
      ws,
      task,
      items.filter((i) => i.id !== item.id),
    )
  }

  return (
    <>
      {items.length > 0 && (
        <ul className="checklist" aria-label={t('checklist.label')}>
          {items.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              task={task}
              siblings={items}
              focused={focusId === item.id}
              onFocused={() => setFocusId(null)}
              onToggle={() => toggle(item)}
              onRename={(title) => rename(item, title)}
              onEnter={() => add(item)}
              onBackspaceEmpty={() => remove(item, true)}
              onRemove={() => remove(item)}
            />
          ))}
        </ul>
      )}
      <div className="checklist-add">
        <button type="button" className="link" onClick={() => add()}>
          + {t('checklist.add')}
        </button>
      </div>
    </>
  )
}

interface RowProps {
  item: ChecklistItem
  task: Task
  siblings: ChecklistItem[]
  focused: boolean
  onFocused: () => void
  onToggle: () => void
  onRename: (title: string) => void
  onEnter: () => void
  onBackspaceEmpty: () => void
  onRemove: () => void
}

function ChecklistRow({
  item,
  task,
  siblings,
  focused,
  onFocused,
  onToggle,
  onRename,
  onEnter,
  onBackspaceEmpty,
  onRemove,
}: RowProps) {
  const t = useT()
  const [draft, setDraft] = useState(item.title)
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const data: DragData = { type: 'checklistItem', item, task, siblings }
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: `check:${item.id}`,
    data,
  })

  useEffect(() => {
    if (!editing) setDraft(item.title)
  }, [item.title, editing])

  useEffect(() => {
    if (focused) {
      ref.current?.focus()
      onFocused()
    }
  }, [focused, onFocused])

  function commit() {
    setEditing(false)
    if (draft !== item.title) onRename(draft)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      commit()
      onEnter()
    } else if (e.key === 'Backspace' && draft === '') {
      e.preventDefault()
      onBackspaceEmpty()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setDraft(item.title)
      setEditing(false)
      e.currentTarget.blur()
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`checklist-item ${item.done ? 'done' : ''} ${isDragging ? 'dragging' : ''}`}
      {...listeners}
    >
      <button
        type="button"
        className="checklist-check"
        aria-label={item.done ? t('checklist.markOpen') : t('checklist.markDone')}
        aria-pressed={item.done}
        onClick={onToggle}
      >
        {item.done && <CheckIcon size={10} />}
      </button>
      <input
        ref={ref}
        className="checklist-input"
        value={draft}
        placeholder={t('checklist.item')}
        aria-label={t('checklist.item')}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="checklist-remove"
        aria-label={t('checklist.remove')}
        title={t('checklist.remove')}
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  )
}
