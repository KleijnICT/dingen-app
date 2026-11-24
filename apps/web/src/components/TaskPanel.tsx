import type { Task } from '@dingen/core'
import { views } from '@dingen/core'
import { ChevronLeft, Copy, FolderPlus, Plus, Trash2, X } from 'lucide-react'
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
import { setWidth, usePanelWidth } from '../prefs.js'
import { PANEL_LIMITS } from '../resize.js'
import { areaPath, navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import {
  commitTask,
  convertToProject,
  deleteTask,
  duplicateTask,
  whenFields,
} from '../taskActions.js'
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
import { DurationField } from './Duration.js'
import { CheckIcon, MoonIcon, ProgressCircle, TodayIcon } from './Icons.js'
import { LinkedNotes } from './LinkedText.js'
import { MoreMenu, Sheet, useDismiss } from './Menu.js'
import { MoveList } from './MoveList.js'
import { Crumb, type CrumbStep, PaneHeader } from './Pane.js'
import { RepeatEditor } from './RepeatEditor.js'
import { ResizeHandle } from './ResizeHandle.js'
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
  /** Set while the open task was just created: adds the next new task in its place. */
  onNext?: (() => void) | undefined
  onToggle: (task: Task) => void
  /** Shows another task in the panel (a duplicate that was just made). */
  onOpen: (id: string) => void
}

/**
 * The detail panel for the open task. It slides in from the right when it opens; another task
 * replaces its content without closing it.
 */
export function TaskPanel({ task, focus, onClose, onNext, onToggle, onOpen }: Props) {
  const slot = useContext(PanelSlot)
  const mode = usePanelMode()
  const panelWidth = usePanelWidth()
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  // The head's right side, where the editor puts its `…` menu and Close.
  const [headActions, setHeadActions] = useState<HTMLDivElement | null>(null)
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
      {mode === 'side' && !closing && (
        <ResizeHandle
          className="panel-resize"
          label={t('panel.resize')}
          width={panelWidth}
          limits={PANEL_LIMITS}
          edge="left"
          room={panelRoom}
          onChange={setPanelWidth}
        />
      )}
      <div ref={root} className={`task-panel ${mode}`} {...a11y} tabIndex={-1} inert={closing}>
        <PaneHeader
          className="panel-head"
          actions={<div className="panel-head-actions" ref={setHeadActions} />}
        >
          {mode === 'full' ? (
            <button type="button" className="panel-back" onClick={onClose}>
              <ChevronLeft size={18} aria-hidden="true" />
              {t('panel.back')}
            </button>
          ) : (
            <TaskCrumb task={shown} />
          )}
        </PaneHeader>
        <div className="panel-body">
          <TaskEditor
            key={shown.id}
            task={shown}
            mode={mode}
            headActions={headActions}
            onClose={onClose}
            onNext={onNext}
            onToggle={() => onToggle(shown)}
            onOpen={onOpen}
          />
        </div>
      </div>
    </div>,
    slot,
  )
}

/** Where the task lives, in the panel's head: its project (and heading) or its area. */
function TaskCrumb({ task }: { task: Task }) {
  const ws = useWorkspace()
  const project = task.projectId ? ws.projectById.get(task.projectId) : undefined
  const area = !project && task.areaId ? ws.areaById.get(task.areaId) : undefined
  const heading = task.headingId ? ws.headingById.get(task.headingId) : undefined
  const steps: CrumbStep[] = []
  if (project && !project.deleted) {
    steps.push({
      key: project.id,
      icon: (
        <ProgressCircle
          value={views.progress(project.id, ws.tasks)}
          someday={views.isSomeday(project)}
          size={14}
        />
      ),
      label: project.title,
      onClick: () => navigate(projectPath(project.id)),
    })
    if (heading && !heading.deleted && heading.title) {
      steps.push({ key: heading.id, label: heading.title })
    }
  } else if (area && !area.deleted) {
    steps.push({
      key: area.id,
      icon: <AreaGlyph icon={area.icon} color={area.color} size={14} />,
      label: area.title,
      onClick: () => navigate(areaPath(area.id)),
    })
  }
  return <Crumb steps={steps} trailing={false} />
}

/** Room for the panel: the window, less the sidebar (gone in focus mode) and the review list. */
function panelRoom(): number {
  const sidebar = document.querySelector('.app > .sidebar')
  const side = document.querySelector('.side-slot')
  return (
    window.innerWidth -
    (sidebar?.getBoundingClientRect().width ?? 0) -
    (side?.getBoundingClientRect().width ?? 0)
  )
}

function setPanelWidth(width: number | null): void {
  setWidth('panel', width)
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
  /** The panel head's right side, for the `…` menu and Close. */
  headActions: HTMLElement | null
  onClose: () => void
  onNext?: (() => void) | undefined
  onToggle: () => void
  onOpen: (id: string) => void
}

/** What gets focus when these fields are added: their text field (without a picker). */
const FOCUS_ON_ADD: Partial<Record<OptionalField, string>> = {
  notes: 'textarea',
  checklist: '.checklist-new input',
  tags: '.tag-input',
}

/**
 * Every field of a task, saved as it changes. Only the header and OK always show; every other
 * field shows with a value, while it has focus, or right after adding it from the Add row.
 */
function TaskEditor({ task, mode, headActions, onClose, onNext, onToggle, onOpen }: EditorProps) {
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

  // The fields just added from the Add row, the one that opens next, and the one with focus:
  // a field being cleared stays until focus leaves it.
  const [added, setAdded] = useState<OptionalField[]>([])
  const [opening, setOpening] = useState<OptionalField | null>(null)
  const [active, setActive] = useState<OptionalField | null>(null)
  const canAssign = useAgents().length > 0
  const checklist = ws.checklistByTask.get(task.id) ?? []
  const checklistCount = checklist.length
  // The notes as typed count, so blurring them does not hide the field before they are saved.
  const extra = { checklist: checklistCount, notes }
  const keep = active && !added.includes(active) ? [...added, active] : added
  const { shown, addable, sections } = fieldLayout(task, keep, canAssign, extra)
  const values = fieldValues(task, extra)
  const has = (name: OptionalField) => shown.includes(name)

  // A field that got its value is shown for that value; clearing it later hides it again.
  useEffect(() => {
    const next = stillAdded(task, added, { checklist: checklistCount, notes })
    if (next.length !== added.length) setAdded(next)
  }, [task, added, checklistCount, notes])

  // Right after adding a field, focus it and open its picker. When and List open their
  // popover by themselves (`autoOpen`), which takes focus into it.
  useEffect(() => {
    if (!opening) return
    setOpening(null)
    if (opening === 'when' || opening === 'list') return
    const row = root.current?.querySelector(`[data-field="${opening}"]`)
    const text = FOCUS_ON_ADD[opening]
    if (text) {
      row?.querySelector<HTMLElement>(text)?.focus()
      return
    }
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
    setActive(null)
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>(`[data-add="${field}"]`)?.focus(),
    )
  }

  /** Escape in a field that was just added and is still empty takes it back (not the panel). */
  function escapeField(field: OptionalField, e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || values[field] || !added.includes(field)) return
    e.preventDefault()
    cancelAdd(field)
  }

  /**
   * An added field left without a value goes away once focus moves on to something else.
   * Focus that lands on nothing, or on the panel around the field (a click on an empty part
   * of a popover), has not moved on.
   */
  function leaveField(field: OptionalField, e: FocusEvent<HTMLElement>) {
    const to = e.relatedTarget as Node | null
    if (!to || e.currentTarget.contains(to) || to.contains(e.currentTarget) || values[field]) {
      return
    }
    forget(field)
  }

  /**
   * Follows which field has focus; focus that moves out of the panel clears it. Focus that
   * arrives elsewhere in the panel also takes back added fields left empty: one whose popover
   * closed on a click outside lost its focus to nothing, so it never saw focus move on.
   * Repeat keeps its own form open.
   */
  function onFocusIn(e: FocusEvent<HTMLElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-field]')
    const next = (el?.dataset.field as OptionalField | undefined) ?? null
    setActive(next)
    setAdded((a) => {
      const kept = a.filter((f) => f === next || f === 'repeat' || values[f])
      return kept.length === a.length ? a : kept
    })
  }
  function onFocusOut(e: FocusEvent<HTMLElement>) {
    const to = e.relatedTarget as Node | null
    if (to && !e.currentTarget.contains(to) && !to.contains(e.currentTarget)) setActive(null)
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
      // A new task with a title: save it and go on to the next one. Enter in an empty title
      // (or Escape) ends the run.
      if (onNext && title.trim()) {
        commit()
        onNext()
      } else close()
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
    notes: t('panel.add.notes'),
    checklist: t('panel.add.checklist'),
    when: t('panel.add.when'),
    time: t('panel.add.time'),
    deadline: t('panel.add.deadline'),
    repeat: t('panel.add.repeat'),
    duration: t('panel.add.duration'),
    list: t('panel.add.list'),
    tags: t('panel.add.tags'),
    assignee: t('panel.add.assignee'),
  }
  // What each chip of the Add row says next to its plus.
  const addTexts: Record<OptionalField, string> = {
    notes: t('task.notes'),
    checklist: t('checklist.label'),
    when: t('when.label'),
    time: t('panel.time'),
    deadline: t('deadline.label'),
    repeat: t('repeat.label'),
    duration: t('duration.label'),
    list: t('panel.list'),
    tags: t('tags.label'),
    assignee: t('assign.toolbar'),
  }
  const progress = checklistProgress(checklist)
  const isToday = task.when.kind === 'date' && task.when.date <= ws.today
  const whenValue = whenText(task, ws.today, t)

  // The `…` menu and Close live in the panel head.
  const headButtons = (
    <>
      <MoreMenu
        alignEnd
        label={t('menu.taskActions')}
        items={[
          {
            label: t('task.duplicate'),
            icon: Copy,
            onSelect: () => {
              commit()
              onOpen(duplicateTask(engine, ws, { ...task, title, notes }).id)
            },
          },
          // Not for a finished task or one occurrence of a repeating task: converting
          // would skip that occurrence and bring the next one straight back.
          ...(task.status === 'open' && task.templateId === null
            ? [
                {
                  label: t('task.convertToProject'),
                  icon: FolderPlus,
                  onSelect: () => convertToProject(engine, ws, { ...task, title, notes }),
                },
              ]
            : []),
          {
            label: t('task.delete'),
            icon: Trash2,
            // A selected task in the list goes with Backspace (or Delete) too.
            shortcut: '⌫',
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
          className="icon-button"
          aria-label={t('panel.close')}
          title={t('panel.close')}
          onClick={close}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </>
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: follows focus, not an action of its own
    <div
      ref={root}
      className={`task-editor ${done ? 'done' : ''}`}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
    >
      <div className="editor-head">
        <button
          type="button"
          className={`check editor-check ${!done && task.when.kind === 'someday' ? 'someday' : ''}`}
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
      </div>
      {headActions && createPortal(headButtons, headActions)}
      {has('notes') && (
        // biome-ignore lint/a11y/noStaticElementInteractions: focus and Escape in the notes, not an action of their own
        <div
          className="editor-notes-field"
          data-field="notes"
          onBlur={(e) => leaveField('notes', e)}
          onKeyDown={(e) => escapeField('notes', e)}
        >
          <LinkedNotes
            textareaRef={notesRef}
            value={notes}
            onChange={setNotes}
            onBlur={commit}
            placeholder={t('task.notes')}
            label={t('task.notes')}
            growKey={mode}
          />
        </div>
      )}

      {sections.includes('checklist') && (
        <section className="panel-section" aria-label={t('checklist.label')}>
          <h3 className="panel-section-label">
            {t('checklist.label')}
            {progress.total > 0 && (
              <span className="panel-section-count">
                {t('checklist.count', { done: progress.done, total: progress.total })}
              </span>
            )}
          </h3>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: focus and Escape in the checklist, not an action of its own */}
          <div
            data-field="checklist"
            onBlur={(e) => leaveField('checklist', e)}
            onKeyDown={(e) => escapeField('checklist', e)}
          >
            <Checklist task={task} />
          </div>
        </section>
      )}

      {sections.includes('planning') && (
        <section className="panel-section" aria-label={t('panel.planning')}>
          <h3 className="panel-section-label">{t('panel.planning')}</h3>
          {has('when') &&
            field(
              'when',
              t('when.label'),
              <PopoverButton
                label={t('when.label')}
                autoOpen={opening === 'when'}
                value={
                  <>
                    {isToday && (
                      <span
                        className={`field-button-icon ${task.daypart === 'evening' ? 'evening' : 'today'}`}
                      >
                        {task.daypart === 'evening' ? (
                          <MoonIcon size={16} />
                        ) : (
                          <TodayIcon size={16} />
                        )}
                      </span>
                    )}
                    <span className="field-button-text">{whenValue}</span>
                  </>
                }
                text={whenValue}
              >
                {(done) => (
                  <WhenPicker
                    when={task.when}
                    daypart={task.daypart}
                    today={ws.today}
                    onChange={(when, daypart, close) => {
                      commitTask(engine, ws, task, whenFields(when, daypart))
                      if (close) done()
                    }}
                  />
                )}
              </PopoverButton>,
            )}
          {has('time') &&
            field(
              'time',
              t('panel.timeLabel'),
              <ScheduleField
                task={task}
                onChange={(fields) => commitTask(engine, ws, task, fields)}
              />,
            )}
          {has('deadline') &&
            field(
              'deadline',
              t('deadline.label'),
              <DeadlineField
                deadline={task.deadline}
                today={ws.today}
                onChange={(deadline) => commitTask(engine, ws, task, { deadline })}
              />,
            )}
          {has('repeat') &&
            field(
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
            )}
          {has('duration') &&
            field(
              'duration',
              t('duration.label'),
              <DurationField
                duration={task.duration}
                onChange={(duration) => commitTask(engine, ws, task, { duration })}
              />,
            )}
        </section>
      )}

      {sections.includes('organization') && (
        <section className="panel-section" aria-label={t('panel.organization')}>
          <h3 className="panel-section-label">{t('panel.organization')}</h3>
          {has('list') &&
            field(
              'list',
              t('panel.list'),
              <ListButton task={task} autoOpen={opening === 'list'} />,
            )}
          {has('tags') &&
            field(
              'tags',
              t('tags.label'),
              <TagEditor
                tagIds={task.tagIds}
                onChange={(tagIds) => commitTask(engine, ws, task, { tagIds })}
              />,
            )}
          {has('assignee') && field('assignee', t('panel.assigned'), <AssigneeField task={task} />)}
        </section>
      )}

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
              <Plus size={14} aria-hidden="true" />
              {addTexts[name]}
            </button>
          ))}
        </fieldset>
      )}

      <div className="panel-footer">
        <button type="button" className="button-primary panel-ok" onClick={close}>
          {t('panel.ok')}
        </button>
      </div>
    </div>
  )
}

/** "Today", "Friday · afternoon", "Someday": the When of a task in a few words. */
export function whenText(task: Task, today: string, t: ReturnType<typeof useT>): string {
  const base =
    task.when.kind === 'date' && task.when.date <= today
      ? t('when.today')
      : describeWhen(task.when, today)
  const text = base.charAt(0).toLocaleUpperCase() + base.slice(1)
  return task.daypart ? `${text} · ${t(`daypart.${task.daypart}`).toLocaleLowerCase()}` : text
}

interface RowProps {
  label: string
  /** Marks an optional field, so adding it can find its input. */
  field?: OptionalField
  onBlur?: ((e: FocusEvent<HTMLElement>) => void) | undefined
  onKeyDown?: ((e: KeyboardEvent<HTMLElement>) => void) | undefined
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

export interface PopoverProps {
  label: string
  /** Opens right away (the field was just added). */
  autoOpen?: boolean
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
export function PopoverButton({ label, autoOpen = false, value, text, children }: PopoverProps) {
  const t = useT()
  const [open, setOpen] = useState(autoOpen)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  // A click outside closes the popover. Focus inside it goes back to the button first, so it
  // moves on from there to what was clicked instead of getting lost with the popover; the
  // field then knows focus left it.
  const close = useCallback(() => {
    if (popover.current?.contains(document.activeElement)) {
      button.current?.focus({ preventScroll: true })
    }
    setOpen(false)
  }, [])
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
        <Sheet
          sheetRef={popover}
          label={label}
          align="stretch"
          className="panel-popover"
          onClose={close}
        >
          {children(done)}
        </Sheet>
      )}
    </div>
  )
}

/** The task's project or area (with its heading) as a button that opens the Move choices. */
export function ListButton({
  task,
  autoOpen = false,
  emptyLabel,
}: {
  task: Task
  autoOpen?: boolean
  /** Shown instead of "No list" when the task has none. */
  emptyLabel?: string
}) {
  const ws = useWorkspace()
  const t = useT()
  const project = task.projectId ? ws.projectById.get(task.projectId) : undefined
  const area = !project && task.areaId ? ws.areaById.get(task.areaId) : undefined
  const heading = task.headingId ? ws.headingById.get(task.headingId) : undefined
  const name = project
    ? project.title || t('project.untitled')
    : area
      ? area.title || t('area.untitled')
      : (emptyLabel ?? t('task.noContainer'))
  const headingName = project && heading ? heading.title || t('project.newHeading') : null
  const icon = project ? (
    <ProgressCircle
      value={views.progress(project.id, ws.tasks)}
      someday={views.isSomeday(project)}
      size={14}
    />
  ) : area ? (
    <AreaGlyph icon={area.icon} color={area.color} size={14} />
  ) : (
    <span className="move-none" />
  )

  return (
    <PopoverButton
      label={t('panel.list')}
      autoOpen={autoOpen}
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
