import type { Task } from '@dingen/core'
import { views } from '@dingen/core'
import { ChevronLeft, X } from 'lucide-react'
import {
  createContext,
  type KeyboardEvent,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { commitTask, deleteTask, moveTask } from '../taskActions.js'
import { type PanelMode, panelMode } from '../taskPanel.js'
import { AssigneeField } from './Assignee.js'
import { Checklist } from './Checklist.js'
import { DeadlineField } from './DeadlineField.js'
import { CheckIcon } from './Icons.js'
import { RepeatEditor } from './RepeatEditor.js'
import { ScheduleField } from './ScheduleField.js'
import { TagEditor } from './TagEditor.js'
import { WhenPicker } from './WhenPicker.js'

/** The element next to the list (in the shell) that the open task's panel renders into. */
export const PanelSlot = createContext<HTMLElement | null>(null)

function subscribeResize(l: () => void) {
  window.addEventListener('resize', l)
  return () => window.removeEventListener('resize', l)
}

/** How the panel sits next to the list at the current window width. */
export function usePanelMode(): PanelMode {
  return useSyncExternalStore(subscribeResize, () => panelMode(window.innerWidth))
}

const SLIDE_MS = 200
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Where focus goes when the panel opens: the panel itself, or the title of a new task. */
export interface PanelFocus {
  target: 'panel' | 'title'
  /** Changes on every request, so asking twice focuses twice. */
  n: number
}

interface Props {
  /** The open task; undefined closes the panel (it slides out first). */
  task: Task | undefined
  focus: PanelFocus | null
  onClose: () => void
  onToggle: (task: Task) => void
}

/**
 * The detail panel for the open task. It slides in from the right when it opens; another task
 * replaces its content without closing it.
 */
export function TaskPanel({ task, focus, onClose, onToggle }: Props) {
  const slot = useContext(PanelSlot)
  const mode = usePanelMode()
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  // The last task shown, so the panel can slide out after it closed.
  const [leaving, setLeaving] = useState<Task | null>(null)
  const last = useRef<Task | undefined>(task)

  useEffect(() => {
    if (task) {
      last.current = task
      setLeaving(null)
      return
    }
    const gone = last.current
    last.current = undefined
    if (!gone || reducedMotion()) return
    setLeaving(gone)
    const timer = setTimeout(() => setLeaving(null), SLIDE_MS)
    return () => clearTimeout(timer)
  }, [task])

  // Each focus request is handled once, when its task is on screen; moving through the list
  // with the arrow keys leaves focus where it is.
  const taskId = task?.id
  const focused = useRef(0)
  useEffect(() => {
    if (!focus || !taskId || focus.n === focused.current) return
    const el = root.current
    if (!el) return
    focused.current = focus.n
    if (focus.target === 'title') el.querySelector<HTMLInputElement>('.editor-title')?.focus()
    else el.focus({ preventScroll: true })
  }, [focus, taskId])

  const shown = task ?? leaving
  if (!slot || !shown) return null
  const closing = !task
  // A dialog over the whole screen on a phone, a region next to the list elsewhere.
  const label = shown.title || t('panel.label')
  const a11y =
    mode === 'full'
      ? { role: 'dialog', 'aria-modal': true, 'aria-label': label }
      : { role: 'complementary', 'aria-label': label }

  return createPortal(
    <div className={`task-panel-host ${mode} ${closing ? 'closing' : ''}`}>
      {mode === 'overlay' && (
        <div
          className="panel-scrim"
          aria-hidden="true"
          onPointerDown={closing ? undefined : onClose}
        />
      )}
      <div ref={root} className={`task-panel ${mode}`} {...a11y} tabIndex={-1} inert={closing}>
        <div className="panel-head">
          {mode === 'full' ? (
            <button type="button" className="panel-back" onClick={onClose}>
              <ChevronLeft size={18} aria-hidden="true" />
              {t('panel.back')}
            </button>
          ) : (
            <span />
          )}
          {mode !== 'full' && (
            <button
              type="button"
              className="panel-close"
              aria-label={t('panel.close')}
              title={t('panel.close')}
              onClick={onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="panel-body">
          <TaskEditor
            key={shown.id}
            task={shown}
            onClose={onClose}
            onToggle={() => onToggle(shown)}
          />
        </div>
      </div>
    </div>,
    slot,
  )
}

interface EditorProps {
  task: Task
  onClose: () => void
  onToggle: () => void
}

/** Every field of a task. Changes are saved on blur or right away. */
function TaskEditor({ task, onClose, onToggle }: EditorProps) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const titleRef = useRef<HTMLInputElement>(null)
  const done = task.status !== 'open'

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
    // biome-ignore lint/a11y/noStaticElementInteractions: Enter in the title closes the editor
    <div className={`task-editor ${done ? 'done' : ''}`} onKeyDown={onKeyDown}>
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
      <ScheduleField task={task} onChange={(fields) => commitTask(engine, ws, task, fields)} />
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
        <AssigneeField task={task} />
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
                  {' '}
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
    </div>
  )
}
