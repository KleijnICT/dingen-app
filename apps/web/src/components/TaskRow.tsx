import type { Tag, Task } from '@dingen/core'
import { views } from '@dingen/core'
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { formatDate, useT } from '../i18n/index.js'
import { containerOf, describeWhen } from '../lists.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { commitTask, deleteTask, moveTask } from '../taskActions.js'
import { Checklist } from './Checklist.js'
import { DeadlineBadge, DeadlineField } from './DeadlineField.js'
import { CheckIcon, ChecklistIcon, MoonIcon, NotesIcon, RepeatIcon } from './Icons.js'
import { RepeatEditor } from './RepeatEditor.js'
import { TagEditor } from './TagEditor.js'
import { WhenPicker } from './WhenPicker.js'

export interface RowProps {
  open: boolean
  showWhen: boolean
  /** Show the project or area under the title (off inside that project or area). */
  showCaption: boolean
  onOpen: () => void
  onClose: () => void
  onToggle: () => void
}

export interface DragHandle {
  ref: (el: HTMLElement | null) => void
  listeners: Record<string, unknown>
  style: CSSProperties
  dragging: boolean
}

interface Props extends RowProps {
  task: Task
  drag?: DragHandle
}

export function TaskRow({
  task,
  open,
  showWhen,
  showCaption,
  onOpen,
  onClose,
  onToggle,
  drag,
}: Props) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
  const done = task.status !== 'open'

  if (open) {
    return <TaskEditor task={task} onClose={onClose} onToggle={onToggle} />
  }

  const container = showCaption ? containerOf(task, ws) : null
  const heading = task.headingId ? ws.headingById.get(task.headingId) : null
  const tags = task.tagIds.map((id) => ws.tagById.get(id)).filter((x): x is Tag => Boolean(x))
  const checklist = views.checklistProgress(ws.checklistByTask.get(task.id) ?? [])

  return (
    <li
      ref={drag?.ref}
      style={drag?.style}
      className={`task ${done ? 'done' : ''} ${drag?.dragging ? 'dragging' : ''}`}
      {...drag?.listeners}
    >
      <button
        type="button"
        className="check"
        aria-label={done ? t('task.markOpen') : t('task.markDone')}
        aria-pressed={done}
        onClick={onToggle}
      >
        {done && <CheckIcon />}
      </button>
      <button type="button" className="task-main" onClick={onOpen}>
        <span className="task-text">
          <span className="task-title">{task.title || <em>{t('task.untitled')}</em>}</span>
          {container && (
            <span className="task-caption">
              {container.title}
              {heading && !showCaption ? ` › ${heading.title}` : ''}
            </span>
          )}
        </span>
        <span className="task-meta">
          {tags.map((tag) => (
            <span key={tag.id} className="tag-chip small">
              {tag.title}
            </span>
          ))}
          {task.evening && <MoonIcon className="meta-icon" />}
          {task.notes && <NotesIcon className="meta-icon" />}
          {checklist.total > 0 && (
            <span className="meta-checklist">
              <ChecklistIcon className="meta-icon" />
              {checklist.done}/{checklist.total}
            </span>
          )}
          {task.templateId && <RepeatIcon className="meta-icon" />}
          {!done && task.deadline && <DeadlineBadge deadline={task.deadline} today={ws.today} />}
          {showWhen && task.when.kind === 'date' && (
            <span className="meta-when">{describeWhen(task.when, ws.today)}</span>
          )}
          {done && task.completedAt && (
            <span className="meta-when">
              {formatDate(new Date(task.completedAt), { dateStyle: 'medium' })}
            </span>
          )}
        </span>
      </button>
      {!done && (
        <button
          type="button"
          className="task-delete"
          aria-label={t('task.delete')}
          title={t('task.delete')}
          onClick={() => deleteTask(engine, ws, task)}
        >
          ×
        </button>
      )}
    </li>
  )
}

interface EditorProps {
  task: Task
  onClose: () => void
  onToggle: () => void
}

function TaskEditor({ task, onClose, onToggle }: EditorProps) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
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
    commitTask(engine, ws, task, fields)
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

  const containerValue = task.projectId
    ? `project:${task.projectId}`
    : task.areaId
      ? `area:${task.areaId}`
      : 'none'
  const headings = task.projectId ? views.headingsOf(ws.headings, task.projectId) : []
  const looseProjects = views.projectsOf(ws.projects, null)
  const areas = views.openAreas(ws.areas)

  function onMove(value: string) {
    if (value === 'none') moveTask(engine, ws, task, { kind: 'none' })
    else if (value.startsWith('project:')) {
      moveTask(engine, ws, task, { kind: 'project', projectId: value.slice(8) })
    } else if (value.startsWith('area:')) {
      moveTask(engine, ws, task, { kind: 'area', areaId: value.slice(5) })
    }
  }

  return (
    <li className={`task editing ${done ? 'done' : ''}`} onKeyDown={onKeyDown}>
      <div className="editor-row">
        <button
          type="button"
          className="check"
          aria-label={done ? t('task.markOpen') : t('task.markDone')}
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
          placeholder={t('task.title')}
        />
      </div>
      <textarea
        className="editor-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commit}
        placeholder={t('task.notes')}
        rows={notes ? Math.min(12, notes.split('\n').length + 1) : 2}
      />
      <Checklist task={task} />
      <WhenPicker
        when={task.when}
        evening={task.evening}
        today={ws.today}
        onChange={(when, evening) => commitTask(engine, ws, task, { when, evening })}
      />
      <div className="editor-line">
        <DeadlineField
          deadline={task.deadline}
          today={ws.today}
          onChange={(deadline) => commitTask(engine, ws, task, { deadline })}
        />
        <RepeatEditor task={task} />
      </div>
      <div className="editor-line">
        <TagEditor
          tagIds={task.tagIds}
          onChange={(tagIds) => commitTask(engine, ws, task, { tagIds })}
        />
      </div>
      <div className="editor-line">
        <select
          className="move-select"
          value={containerValue}
          onChange={(e) => onMove(e.target.value)}
          aria-label={t('task.moveTo')}
        >
          <option value="none">{t('task.noContainer')}</option>
          {looseProjects.length > 0 && (
            <optgroup label={t('move.projects')}>
              {looseProjects.map((p) => (
                <option key={p.id} value={`project:${p.id}`}>
                  {p.title || t('project.untitled')}
                </option>
              ))}
            </optgroup>
          )}
          {areas.map((area) => (
            <optgroup key={area.id} label={area.title || t('area.untitled')}>
              <option value={`area:${area.id}`}>{area.title || t('area.untitled')}</option>
              {views.projectsOf(ws.projects, area.id).map((p) => (
                <option key={p.id} value={`project:${p.id}`}>
                  {' '}
                  {p.title || t('project.untitled')}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {headings.length > 0 && task.projectId && (
          <fieldset className="heading-picker" aria-label={t('project.heading')}>
            <button
              type="button"
              className={`chip small ${task.headingId === null ? 'active' : ''}`}
              onClick={() =>
                moveTask(engine, ws, task, {
                  kind: 'project',
                  projectId: task.projectId as string,
                  headingId: null,
                })
              }
            >
              {t('project.noHeading')}
            </button>
            {headings.map((h) => (
              <button
                type="button"
                key={h.id}
                className={`chip small ${task.headingId === h.id ? 'active' : ''}`}
                onClick={() =>
                  moveTask(engine, ws, task, {
                    kind: 'project',
                    projectId: task.projectId as string,
                    headingId: h.id,
                  })
                }
              >
                {h.title || t('project.newHeading')}
              </button>
            ))}
          </fieldset>
        )}
      </div>
      <div className="editor-foot">
        <button
          type="button"
          className="link danger"
          onClick={() => {
            deleteTask(engine, ws, task)
            onClose()
          }}
        >
          {t('task.delete')}
        </button>
        <button type="button" className="link" onClick={close}>
          {t('task.done')}
        </button>
      </div>
    </li>
  )
}
