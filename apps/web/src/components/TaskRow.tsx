import type { Task } from '@dingen/core'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { describeWhen } from '../lists.js'
import { useEngine } from '../store/context.js'
import { CheckIcon, MoonIcon, NotesIcon } from './Icons.js'
import { WhenPicker } from './WhenPicker.js'

interface Props {
  task: Task
  today: string
  open: boolean
  showWhen: boolean
  onOpen: () => void
  onClose: () => void
  onToggle: () => void
}

export function TaskRow({ task, today, open, showWhen, onOpen, onClose, onToggle }: Props) {
  const engine = useEngine()
  const done = task.status !== 'open'

  if (open) {
    return <TaskEditor task={task} today={today} onClose={onClose} onToggle={onToggle} />
  }

  return (
    <li className={`task ${done ? 'done' : ''}`}>
      <button
        type="button"
        className="check"
        aria-label={done ? 'Markeer als open' : 'Markeer als klaar'}
        aria-pressed={done}
        onClick={onToggle}
      >
        {done && <CheckIcon />}
      </button>
      <button type="button" className="task-main" onClick={onOpen}>
        <span className="task-title">{task.title || <em>Zonder titel</em>}</span>
        <span className="task-meta">
          {task.evening && <MoonIcon className="meta-icon" />}
          {task.notes && <NotesIcon className="meta-icon" />}
          {showWhen && task.when.kind === 'date' && (
            <span className="meta-when">{describeWhen(task.when, today)}</span>
          )}
          {done && task.completedAt && (
            <span className="meta-when">
              {new Date(task.completedAt).toLocaleDateString('nl-NL')}
            </span>
          )}
        </span>
      </button>
      {!done && (
        <button
          type="button"
          className="task-delete"
          aria-label="Verwijder taak"
          title="Verwijderen"
          onClick={() => engine.mutate('task', task.id, { deleted: true })}
        >
          ×
        </button>
      )}
    </li>
  )
}

interface EditorProps {
  task: Task
  today: string
  onClose: () => void
  onToggle: () => void
}

function TaskEditor({ task, today, onClose, onToggle }: EditorProps) {
  const engine = useEngine()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const titleRef = useRef<HTMLInputElement>(null)
  const done = task.status !== 'open'

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  function commit() {
    const fields: Record<string, unknown> = {}
    if (title !== task.title) fields.title = title
    if (notes !== task.notes) fields.notes = notes
    if (Object.keys(fields).length > 0) engine.mutate('task', task.id, fields)
  }

  function close() {
    commit()
    onClose()
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
    if (e.key === 'Enter' && e.target === titleRef.current) {
      e.preventDefault()
      close()
    }
  }

  return (
    <li className={`task editing ${done ? 'done' : ''}`} onKeyDown={onKeyDown}>
      <div className="editor-row">
        <button
          type="button"
          className="check"
          aria-label={done ? 'Markeer als open' : 'Markeer als klaar'}
          aria-pressed={done}
          onClick={onToggle}
        >
          {done && <CheckIcon />}
        </button>
        <input
          ref={titleRef}
          className="editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          placeholder="Titel"
        />
      </div>
      <textarea
        className="editor-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commit}
        placeholder="Notities"
        rows={notes ? Math.min(12, notes.split('\n').length + 1) : 2}
      />
      <WhenPicker
        when={task.when}
        evening={task.evening}
        today={today}
        onChange={(when, evening) => engine.mutate('task', task.id, { when, evening })}
      />
      <div className="editor-foot">
        <button
          type="button"
          className="link danger"
          onClick={() => {
            engine.mutate('task', task.id, { deleted: true })
            onClose()
          }}
        >
          Verwijderen
        </button>
        <button type="button" className="link" onClick={close}>
          Klaar
        </button>
      </div>
    </li>
  )
}
