import type { Task } from '@dingen/core'
import { views } from '@dingen/core'
import { ChevronLeft, Plus, X } from 'lucide-react'
import {
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { useAgents } from '../agents.js'
import { useT } from '../i18n/index.js'
import { describeWhen } from '../lists.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { commitTask, deleteTask, duplicateTask } from '../taskActions.js'
import {
  checklistProgress,
  fieldLayout,
  fieldValues,
  type OptionalField,
  type PanelMode,
  panelMode,
  stillAdded,
} from '../taskPanel.js'
import { AreaGlyph } from './AreaIcons.js'
import { AssigneeField } from './Assignee.js'
import { Checklist } from './Checklist.js'
import { DeadlineField } from './DeadlineField.js'
import { CheckIcon, MoonIcon, ProgressCircle, TodayIcon } from './Icons.js'
import { MoreMenu, useDismiss } from './Menu.js'
import { MoveList } from './MoveList.js'
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
  /** Shows another task in the panel (a duplicate that was just made). */
  onOpen: (id: string) => void
}

/**
 * The detail panel for the open task. It slides in from the right when it opens; another task
 * replaces its content without closing it.
 */
export function TaskPanel({ task, focus, onClose, onToggle, onOpen }: Props) {
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
    if (focus.target === 'title') el.querySelector<HTMLElement>('.editor-title')?.focus()
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
        {mode === 'full' && (
          <div className="panel-head">
            <button type="button" className="panel-back" onClick={onClose}>
              <ChevronLeft size={18} aria-hidden="true" />
              {t('panel.back')}
            </button>
          </div>
        )}
        <div className="panel-body">
          <TaskEditor
            key={shown.id}
            task={shown}
            mode={mode}
            onClose={onClose}
            onToggle={() => onToggle(shown)}
            onOpen={onOpen}
          />
        </div>
      </div>
    </div>,
    slot,
  )
}

/** Grows a text area with its content, so notes and long titles never scroll on their own. */
function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, mode: PanelMode) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows text and width
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value, mode])
}

interface EditorProps {
  task: Task
  mode: PanelMode
  onClose: () => void
  onToggle: () => void
  onOpen: (id: string) => void
}

/**
 * Every field of a task, saved as it changes. Notes, checklist, When, List and Tags always
 * show; time, deadline, repeat and assignee only with a value, else from the Add row.
 */
function TaskEditor({ task, mode, onClose, onToggle, onOpen }: EditorProps) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const done = task.status !== 'open'
  useAutoGrow(titleRef, title, mode)
  useAutoGrow(notesRef, notes, mode)

  // Optional fields: the ones just added from the Add row, and the one whose picker opens next.
  const [added, setAdded] = useState<OptionalField[]>([])
  const [opening, setOpening] = useState<OptionalField | null>(null)
  const canAssign = useAgents().length > 0
  const { shown, addable } = fieldLayout(task, added, canAssign)
  const values = fieldValues(task)

  // A field that got its value is shown for that value; clearing it later hides it again.
  useEffect(() => {
    const next = stillAdded(task, added)
    if (next.length !== added.length) setAdded(next)
  }, [task, added])

  // Right after adding a field, focus it and open its picker.
  useEffect(() => {
    if (!opening) return
    setOpening(null)
    const row = root.current?.querySelector(`[data-field="${opening}"]`)
    const el = row?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')
    if (!el) return
    el.focus()
    if (opening === 'repeat') return
    try {
      el.showPicker?.()
    } catch {
      // Not every browser opens a picker from code; the field has focus either way.
    }
  }, [opening])

  function add(field: OptionalField) {
    setAdded((a) => [...a, field])
    setOpening(field)
  }

  const forget = useCallback((field: OptionalField) => {
    setAdded((a) => a.filter((f) => f !== field))
  }, [])

  /** Takes back an added field that got no value; focus returns to its button in the Add row. */
  function cancelAdd(field: OptionalField) {
    forget(field)
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>(`[data-add="${field}"]`)?.focus(),
    )
  }

  /** Escape in a field that was just added and is still empty takes it back (not the panel). */
  function escapeField(field: OptionalField, e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || values[field] || !added.includes(field)) return
    e.preventDefault()
    cancelAdd(field)
  }

  /** An added field left without a value goes away once focus moves on to something else. */
  function leaveField(field: OptionalField, e: FocusEvent<HTMLDivElement>) {
    const to = e.relatedTarget as Node | null
    if (!to || e.currentTarget.contains(to) || values[field]) return
    forget(field)
  }

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

  function onTitleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      close()
    }
  }

  const field = (
    name: OptionalField,
    label: string,
    control: ReactNode,
    // Repeat closes its own form; leaving it open should not throw the draft away.
    leave = true,
  ) => (
    <FieldRow
      key={name}
      label={label}
      field={name}
      onBlur={leave ? (e) => leaveField(name, e) : undefined}
      onKeyDown={(e) => escapeField(name, e)}
    >
      {control}
    </FieldRow>
  )

  const addLabels: Record<OptionalField, string> = {
    time: t('panel.add.time'),
    deadline: t('panel.add.deadline'),
    repeat: t('panel.add.repeat'),
    assignee: t('panel.add.assignee'),
  }
  // What each chip of the Add row says next to its plus.
  const addTexts: Record<OptionalField, string> = {
    time: t('panel.time'),
    deadline: t('deadline.label'),
    repeat: t('repeat.label'),
    assignee: t('assign.toolbar'),
  }
  const planning = shown.filter((f) => f !== 'assignee')
  const progress = checklistProgress(ws.checklistByTask.get(task.id) ?? [])
  const isToday = task.when.kind === 'date' && task.when.date <= ws.today

  return (
    <div ref={root} className={`task-editor ${done ? 'done' : ''}`}>
      <div className="editor-head">
        <button
          type="button"
          className="check editor-check"
          aria-label={done ? t('task.markOpen') : t('task.markDone')}
          aria-pressed={done}
          onClick={onToggle}
        >
          {done && <CheckIcon />}
        </button>
        <textarea
          ref={titleRef}
          className="editor-title"
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\s*\n\s*/g, ' '))}
          onBlur={commit}
          onKeyDown={onTitleKeyDown}
          placeholder={t('task.title')}
          aria-label={t('task.title')}
        />
        <MoreMenu
          alignEnd
          label={t('menu.taskActions')}
          items={[
            {
              label: t('task.duplicate'),
              onSelect: () => {
                commit()
                onOpen(duplicateTask(engine, ws, { ...task, title, notes }).id)
              },
            },
            {
              label: t('task.delete'),
              danger: true,
              confirm: t('task.deleteQuestion'),
              onSelect: () => {
                deleteTask(engine, ws, task)
                onClose()
              },
            },
          ]}
        />
        {mode !== 'full' && (
          <button
            type="button"
            className="panel-close"
            aria-label={t('panel.close')}
            title={t('panel.close')}
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <textarea
        ref={notesRef}
        className="editor-notes"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commit}
        placeholder={t('task.notes')}
        aria-label={t('task.notes')}
      />
      <section className="panel-section" aria-label={t('checklist.label')}>
        <h3 className="panel-section-label">
          {t('checklist.label')}
          {progress.total > 0 && (
            <span className="panel-section-count">
              {t('checklist.count', { done: progress.done, total: progress.total })}
            </span>
          )}
        </h3>
        <Checklist task={task} />
      </section>

      <section className="panel-section" aria-label={t('panel.planning')}>
        <h3 className="panel-section-label">{t('panel.planning')}</h3>
        <FieldRow label={t('when.label')}>
          <PopoverButton
            label={t('when.label')}
            value={
              <>
                {isToday && (
                  <span className={`field-button-icon ${task.evening ? 'evening' : 'today'}`}>
                    {task.evening ? <MoonIcon size={15} /> : <TodayIcon size={15} />}
                  </span>
                )}
                <span className="field-button-text">{whenText(task, ws.today, t)}</span>
              </>
            }
            text={whenText(task, ws.today, t)}
          >
            {(done) => (
              <WhenPicker
                when={task.when}
                evening={task.evening}
                today={ws.today}
                onChange={(when, evening) => {
                  commitTask(engine, ws, task, { when, evening })
                  done()
                }}
              />
            )}
          </PopoverButton>
        </FieldRow>
        {planning.map((name) =>
          name === 'time'
            ? field(
                'time',
                t('panel.timeLabel'),
                <ScheduleField
                  task={task}
                  onChange={(fields) => commitTask(engine, ws, task, fields)}
                />,
              )
            : name === 'deadline'
              ? field(
                  'deadline',
                  t('deadline.label'),
                  <DeadlineField
                    deadline={task.deadline}
                    today={ws.today}
                    onChange={(deadline) => commitTask(engine, ws, task, { deadline })}
                  />,
                )
              : field(
                  'repeat',
                  t('repeat.label'),
                  <RepeatEditor
                    task={task}
                    autoOpen={!values.repeat}
                    onClosed={() => {
                      if (!values.repeat) cancelAdd('repeat')
                    }}
                  />,
                  false,
                ),
        )}
      </section>

      <section className="panel-section" aria-label={t('panel.organization')}>
        <h3 className="panel-section-label">{t('panel.organization')}</h3>
        <FieldRow label={t('panel.list')}>
          <ListButton task={task} />
        </FieldRow>
        <FieldRow label={t('tags.label')}>
          <TagEditor
            tagIds={task.tagIds}
            onChange={(tagIds) => commitTask(engine, ws, task, { tagIds })}
          />
        </FieldRow>
        {shown.includes('assignee') &&
          field('assignee', t('panel.assigned'), <AssigneeField task={task} />)}
      </section>

      {addable.length > 0 && (
        <fieldset className="panel-add">
          <legend className="panel-add-legend">{t('panel.add')}</legend>
          {addable.map((name) => (
            <button
              key={name}
              type="button"
              className="panel-add-button"
              data-add={name}
              aria-label={addLabels[name]}
              onClick={() => add(name)}
            >
              <Plus size={13} strokeWidth={2} aria-hidden="true" />
              {addTexts[name]}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  )
}

/** "Today", "This Evening", "Fri", "Someday": the When of a task in a few words. */
function whenText(task: Task, today: string, t: ReturnType<typeof useT>): string {
  if (task.when.kind === 'date' && task.when.date <= today) {
    return task.evening ? t('when.thisEvening') : t('when.today')
  }
  const text = describeWhen(task.when, today)
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

interface RowProps {
  label: string
  /** Marks an optional field, so adding it can find its input. */
  field?: OptionalField
  onBlur?: ((e: FocusEvent<HTMLDivElement>) => void) | undefined
  onKeyDown?: ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined
  children: ReactNode
}

/** One field of the panel: a muted word as its label, and the value next to it. */
function FieldRow({ label, field, onBlur, onKeyDown, children }: RowProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus and Escape in the row's own field, not an action of the row
    <div className="panel-field" data-field={field} onBlur={onBlur} onKeyDown={onKeyDown}>
      <span className="panel-field-label">{label}</span>
      <div className="panel-field-value">{children}</div>
    </div>
  )
}

interface PopoverProps {
  label: string
  /** What the button shows. */
  value: ReactNode
  /** The value as text, for screen readers. */
  text: string
  children: (done: () => void) => ReactNode
}

/**
 * A field's value as a button that opens its choices in a small popover. Escape or a click
 * outside closes the popover (not the panel); choosing closes it and returns focus.
 */
function PopoverButton({ label, value, text, children }: PopoverProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, root, button)

  // Opening moves focus to the current choice, so the keyboard can carry on from there.
  useEffect(() => {
    if (!open) return
    const el = popover.current
    const current = el?.querySelector<HTMLElement>('[aria-pressed="true"], .chip.active')
    ;(current ?? el?.querySelector<HTMLElement>('button, input'))?.focus()
  }, [open])

  function done() {
    setOpen(false)
    button.current?.focus()
  }

  return (
    <div className="panel-popover-anchor" ref={root}>
      <button
        ref={button}
        type="button"
        className="field-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('panel.field', { label, value: text })}
        onClick={() => setOpen((o) => !o)}
      >
        {value}
      </button>
      {open && (
        <div ref={popover} className="popover panel-popover" role="dialog" aria-label={label}>
          {children(done)}
        </div>
      )}
    </div>
  )
}

/** The task's project or area (with its heading) as a button that opens the Move choices. */
function ListButton({ task }: { task: Task }) {
  const ws = useWorkspace()
  const t = useT()
  const project = task.projectId ? ws.projectById.get(task.projectId) : undefined
  const area = !project && task.areaId ? ws.areaById.get(task.areaId) : undefined
  const heading = task.headingId ? ws.headingById.get(task.headingId) : undefined
  const name = project
    ? project.title || t('project.untitled')
    : area
      ? area.title || t('area.untitled')
      : t('task.noContainer')
  const headingName = project && heading ? heading.title || t('project.newHeading') : null
  const icon = project ? (
    <ProgressCircle value={views.progress(project.id, ws.tasks)} size={14} />
  ) : area ? (
    <AreaGlyph icon={area.icon} color={area.color} size={14} />
  ) : (
    <span className="move-none" />
  )

  return (
    <PopoverButton
      label={t('panel.list')}
      text={headingName ? `${name}, ${headingName}` : name}
      value={
        <>
          <span className={`field-button-icon ${project ? 'project' : ''}`}>{icon}</span>
          <span className="field-button-text">
            {name}
            {headingName && (
              <>
                <span className="field-button-sep" aria-hidden="true">
                  {' › '}
                </span>
                {headingName}
              </>
            )}
          </span>
        </>
      }
    >
      {(done) => <MoveList task={task} onDone={done} withHeadings />}
    </PopoverButton>
  )
}
