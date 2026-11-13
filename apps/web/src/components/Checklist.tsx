import { type ChecklistItem, newChecklistItem, orderBetween, type Task } from '@dingen/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { DragData } from '../dnd.js'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { mirrorChecklist } from '../taskActions.js'
import { CheckIcon } from './Icons.js'

interface Props {
  task: Task
}

/**
 * The checklist inside a task editor: tick, title, remove, and a field for the next item at
 * the bottom. Enter in an item adds one below it; in the last item it goes to the new field.
 */
export function Checklist({ task }: Props) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
  const items = ws.checklistByTask.get(task.id) ?? []
  const [focusId, setFocusId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const newRef = useRef<HTMLInputElement>(null)

  function append(title: string) {
    const clean = title.trim()
    if (!clean) return
    const item = newChecklistItem({
      title: clean,
      taskId: task.id,
      order: orderBetween(items.at(-1)?.order ?? null, null),
    })
    engine.create('checklistItem', item)
    mirrorChecklist(engine, ws, task, [...items, item])
    setDraft('')
  }

  function onNewKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      append(draft)
    } else if (e.key === 'Escape' && draft !== '') {
      e.preventDefault()
      setDraft('')
    } else if (e.key === 'Backspace' && draft === '' && items.length > 0) {
      e.preventDefault()
      setFocusId(items.at(-1)?.id ?? null)
    }
  }

  function add(after: ChecklistItem) {
    const index = items.indexOf(after)
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
              onEnter={() => (item === items.at(-1) ? newRef.current?.focus() : add(item))}
              onBackspaceEmpty={() => remove(item, true)}
              onRemove={() => remove(item)}
            />
          ))}
        </ul>
      )}
      <div className="checklist-new">
        <Plus size={14} className="checklist-new-icon" aria-hidden="true" />
        <input
          ref={newRef}
          className="checklist-input"
          value={draft}
          placeholder={t('checklist.add')}
          aria-label={t('checklist.add')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onNewKeyDown}
          onBlur={() => append(draft)}
        />
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
