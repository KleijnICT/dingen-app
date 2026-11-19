import {
  type Area,
  type AreaCount,
  type AreaGroup,
  type AreaItem,
  type AreaProjects,
  eventsOnDay,
  type Heading,
  isReviewedIn,
  lastCompletedReview,
  newTask,
  orderBetween,
  type Project,
  type Review,
  type ReviewItems,
  type ReviewStepId,
  reviewItems,
  type Signal,
  signals,
  somedayGroupKey,
  type Task,
  views,
  type When,
} from '@dingen/core'
import {
  CalendarDays,
  Check,
  CircleCheck,
  List,
  SkipForward,
  SquarePen,
  Trash2,
  UserRound,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useCalendarData } from '../calendar.js'
import { type MessageKey, useT } from '../i18n/index.js'
import { setInboxStepView, useInboxStepView } from '../prefs.js'
import { nextToReview, withDoneStep, withoutDoneStep } from '../reviewFlow.js'
import { areaPath, navigate, projectPath, setTaskParam } from '../router.js'
import { projectSections } from '../sections.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { tagForName } from '../tags.js'
import {
  commitTask,
  deleteProject,
  deleteTask,
  toggleProject,
  toggleTask,
  useLinger,
  whenFields,
} from '../taskActions.js'
import { AreaGlyph } from './AreaIcons.js'
import { useAssignChoices } from './Assignee.js'
import { DayEvents } from './CalendarEvents.js'
import { ProgressCircle } from './Icons.js'
import { LinkedText } from './LinkedText.js'
import { MemberAvatar, useMembers } from './MemberAvatar.js'
import { MoreMenu } from './Menu.js'
import { HeadingRow } from './ProjectPage.js'
import { ProjectRow } from './ProjectRow.js'
import { TaskGroup } from './TaskGroup.js'
import { ListButton, PopoverButton, whenText } from './TaskPanel.js'
import type { RowProps } from './TaskRow.js'
import { TaskToolbar } from './Toolbar.js'
import { useReviews } from './useReviews.js'
import { useTaskList } from './useTaskList.js'
import { WhenPicker } from './WhenPicker.js'

interface StepProps {
  review: Review
  stepId: ReviewStepId
}

/** The body of one review step; what it shows comes from `reviewItems` in core. */
export function ReviewStepView({ review, stepId }: StepProps) {
  const ws = useWorkspace()
  const reviews = useReviews()
  const since = lastCompletedReview(reviews, 'daily')?.completedAt ?? null
  const items = reviewItems(stepId, ws, ws.today, { since })
  switch (items.kind) {
    case 'none':
      return <CaptureStep triggers={stepId === 'triggers'} />
    case 'day':
      return <DayOverviewStep items={items} />
    case 'tasks':
      return <InboxStep tasks={items.tasks} />
    case 'logbook':
      return <LookBackStep tasks={items.tasks} projects={items.projects} perArea={items.perArea} />
    case 'dated':
      return <DueSoonStep tasks={items.tasks} projects={items.projects} />
    case 'areaProjects':
      return <AreasAndProjectsStep review={review} groups={items.groups} />
    case 'areas':
      return <AreasStep review={review} areas={items.areas} deep={stepId === 'areasDeep'} />
    case 'someday':
      return <SomedayScanStep tasks={items.tasks} projects={items.projects} />
    case 'somedayGroups':
      return <SomedayDeepStep review={review} projects={items.projects} groups={items.groups} />
  }
}

// --- Task lists ---

/** One selection and one open task for everything a step shows, like a list page. */
function useStepTasks(visible: Task[]) {
  const engine = useEngine()
  const ws = useWorkspace()
  const { shown, toggle } = useLinger(visible, ws, engine)
  const taskList = useTaskList(shown, toggle)
  /** The shown tasks (including those just checked off) that belong to one group. */
  const where = (belongs: (task: Task) => boolean) => shown.filter(belongs)
  const group = (key: string, tasks: Task[], extra: Partial<RowProps> = {}) => (
    <TaskGroup
      group={{ key: `review:${key}`, target: null }}
      tasks={tasks}
      rowProps={(task) => taskList.rowProps(task, extra)}
      frozen
    />
  )
  return { shown, taskList, group, where }
}

// --- Day overview (daily review) ---

type DayItems = Extract<ReviewItems, { kind: 'day' }>

/**
 * How the day looks, read only: today's events, what is overdue, deadlines today and
 * tomorrow, what came into the Inbox since the previous daily review and what is
 * assigned to you.
 */
function DayOverviewStep({ items }: { items: DayItems }) {
  const t = useT()
  const ws = useWorkspace()
  const { members } = useMembers()
  const calendar = useCalendarData()
  const me = members.find((m) => m.kind === 'user')?.id ?? null
  const assigned =
    me === null
      ? []
      : ws.tasks
          .filter((x) => !x.deleted && x.repeat === null && views.isOpen(x) && x.assigneeId === me)
          .sort(views.byOrder)
  const unique = [
    ...new Map(
      [...items.overdue.tasks, ...items.deadlines.tasks, ...items.newInbox, ...assigned].map(
        (x) => [x.id, x],
      ),
    ).values(),
  ]
  const { taskList, where } = useStepTasks(unique)
  const ids = (list: Task[]) => new Set(list.map((x) => x.id))
  const section = (
    key: string,
    title: string,
    tasks: Task[],
    projects: Project[] = [],
    extra: Partial<RowProps> = {},
  ) => {
    if (tasks.length === 0 && projects.length === 0) return null
    const inSection = ids(tasks)
    return (
      <div className="group">
        <h2 className="group-title">{title}</h2>
        {projects.length > 0 && (
          <ul className="tasks">
            {projects.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        )}
        <TaskGroup
          group={{ key: `review:day:${key}`, target: null }}
          tasks={where((x) => inSection.has(x.id))}
          rowProps={(task) => taskList.rowProps(task, { showCaption: true, ...extra })}
          frozen
        />
      </div>
    )
  }
  const quiet =
    unique.length === 0 &&
    items.overdue.projects.length === 0 &&
    items.deadlines.projects.length === 0

  return (
    <>
      <div className="group">
        <h2 className="group-title">{t('review.day.events')}</h2>
        {eventsOnDay(calendar.events, ws.today).length > 0 ? (
          <DayEvents date={ws.today} />
        ) : (
          <p className="muted review-day-none">{t('review.day.noEvents')}</p>
        )}
      </div>
      {section('overdue', t('review.day.overdue'), items.overdue.tasks, items.overdue.projects)}
      {section(
        'deadlines',
        t('review.day.deadlines'),
        items.deadlines.tasks,
        items.deadlines.projects,
      )}
      {section('new', t('review.day.newInbox'), items.newInbox, [], { showWhen: true })}
      {section('assigned', t('review.day.assigned'), assigned, [], { showWhen: true })}
      {quiet && <p className="empty">{t('review.day.quiet')}</p>}
      <TaskToolbar list={taskList} />
      {taskList.panel}
    </>
  )
}

// --- The Inbox, one at a time or as a list ---

/** The Inbox: a task leaves the step once it is processed (a list and a When). */
function InboxStep(props: { tasks: Task[] }) {
  const t = useT()
  const view = useInboxStepView()
  const { shown, taskList } = useStepTasks(props.tasks)
  if (shown.length > 0 && view === 'cards') return <InboxCards tasks={props.tasks} />
  return (
    <>
      {shown.length === 0 ? (
        <p className="empty review-empty">
          <Check size={16} className="review-ok" aria-hidden="true" /> {t('review.inbox.empty')}
        </p>
      ) : (
        <>
          <p className="review-view-switch">
            <button type="button" className="link" onClick={() => setInboxStepView('cards')}>
              {t('review.inbox.oneByOne')}
            </button>
          </p>
          <TaskGroup
            group={{ key: 'review:inbox', target: null }}
            tasks={shown}
            rowProps={(task) => taskList.rowProps(task, { showWhen: true, showCaption: true })}
            frozen
          />
        </>
      )}
      <TaskToolbar list={taskList} />
      {taskList.panel}
    </>
  )
}

/**
 * One Inbox task at a time, with the GTD choices: done in two minutes, delete, when, where
 * and delegate. Once it has a list and a When it leaves the Inbox and the next one shows.
 * Skip puts a task at the back for this visit.
 */
function InboxCards({ tasks }: { tasks: Task[] }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const [skipped, setSkipped] = useState<string[]>([])
  const { taskList } = useStepTasks(tasks)
  const back = skipped.flatMap((id) => tasks.filter((x) => x.id === id))
  const queue = [...tasks.filter((x) => !skipped.includes(x.id)), ...back]
  const task = queue[0]
  if (!task) return null
  const index = tasks.length - queue.length + 1

  return (
    <>
      <p className="review-view-switch">
        <button type="button" className="link" onClick={() => setInboxStepView('list')}>
          <List size={14} aria-hidden="true" /> {t('review.inbox.asList')}
        </button>
      </p>
      <article key={task.id} className="review-card inbox-card">
        <p className="review-card-count muted">
          {t('review.inbox.count', { n: index, total: tasks.length })}
        </p>
        <header className="review-card-head">
          <div className="review-card-title">
            <button type="button" className="link" onClick={() => setTaskParam(task.id)}>
              {task.title || t('task.untitled')}
            </button>
          </div>
        </header>
        {task.notes && (
          <p className="review-card-notes">
            <LinkedText text={task.notes} />
          </p>
        )}
        <div className="inbox-card-fields">
          <WhenButton task={task} />
          <ListButton task={task} emptyLabel={t('review.inbox.where')} />
          <Delegate task={task} />
        </div>
        <div className="inbox-card-actions">
          <button type="button" className="chip" onClick={() => toggleTask(engine, ws, task)}>
            <CircleCheck size={15} aria-hidden="true" /> {t('review.inbox.done')}
          </button>
          <button type="button" className="chip" onClick={() => deleteTask(engine, ws, task)}>
            <Trash2 size={15} aria-hidden="true" /> {t('review.inbox.delete')}
          </button>
          <button type="button" className="chip" onClick={() => setTaskParam(task.id)}>
            <SquarePen size={15} aria-hidden="true" /> {t('review.inbox.open')}
          </button>
          {queue.length > 1 && (
            <button
              type="button"
              className="chip inbox-card-skip"
              onClick={() => setSkipped((s) => [...s.filter((id) => id !== task.id), task.id])}
            >
              {t('review.inbox.skip')} <SkipForward size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </article>
      {taskList.panel}
    </>
  )
}

/** When as a button that opens the usual picker; a task still in the Inbox shows "When". */
function WhenButton({ task }: { task: Task }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const text = task.when.kind === 'inbox' ? t('review.inbox.when') : whenText(task, ws.today, t)
  return (
    <PopoverButton
      label={t('when.label')}
      text={text}
      value={
        <>
          <CalendarDays size={15} className="field-button-icon" aria-hidden="true" />
          <span className="field-button-text">{text}</span>
        </>
      }
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
    </PopoverButton>
  )
}

const WAITING = 'waiting'

/** Delegate: assign to a member (an agent), or tag the task `waiting` for someone else. */
function Delegate({ task }: { task: Task }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const { agents } = useAssignChoices(task)
  const waiting = ws.tags.find((x) => !x.deleted && x.title === WAITING)
  const isWaiting = waiting !== undefined && task.tagIds.includes(waiting.id)
  const assignee = agents.find((m) => m.id === task.assigneeId)

  function toggleWaiting() {
    if (isWaiting && waiting) {
      commitTask(engine, ws, task, { tagIds: task.tagIds.filter((id) => id !== waiting.id) })
      return
    }
    const found = tagForName(ws.tags, WAITING)
    if (!found) return
    if (found.created) engine.create('tag', found.tag)
    commitTask(engine, ws, task, { tagIds: [...task.tagIds, found.tag.id] })
  }

  const text = assignee
    ? assignee.name
    : isWaiting
      ? t('review.inbox.someoneElse')
      : t('review.inbox.delegate')
  return (
    <PopoverButton
      label={t('review.inbox.delegate')}
      text={text}
      value={
        <>
          {assignee ? (
            <MemberAvatar member={assignee} size={16} title={false} />
          ) : (
            <UserRound size={15} className="field-button-icon" aria-hidden="true" />
          )}
          <span className="field-button-text">{text}</span>
        </>
      }
    >
      {(done) => (
        <div className="when-picker">
          {agents.map((m) => (
            <button
              type="button"
              key={m.id}
              className={`chip ${task.assigneeId === m.id ? 'active' : ''}`}
              aria-pressed={task.assigneeId === m.id}
              onClick={() => {
                commitTask(engine, ws, task, {
                  assigneeId: task.assigneeId === m.id ? null : m.id,
                })
                done()
              }}
            >
              <MemberAvatar member={m} size={16} title={false} /> {m.name}
            </button>
          ))}
          <button
            type="button"
            className={`chip ${isWaiting ? 'active' : ''}`}
            aria-pressed={isWaiting}
            onClick={() => {
              toggleWaiting()
              done()
            }}
          >
            {t('review.inbox.someoneElse')}
          </button>
        </div>
      )}
    </PopoverButton>
  )
}

// --- Clear your head, Anything forgotten ---

const TRIGGERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

/** A field that puts every line straight into the Inbox. */
function CaptureStep({ triggers }: { triggers: boolean }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const [draft, setDraft] = useState('')
  const [added, setAdded] = useState<string[]>([])

  function add() {
    const title = draft.trim()
    if (!title) return
    const last = views.inbox(ws.tasks).at(-1)
    engine.create(
      'task',
      newTask({ title, when: { kind: 'inbox' }, order: orderBetween(last?.order ?? null, null) }),
    )
    setAdded((a) => [...a, title])
    setDraft('')
  }

  return (
    <div className="review-capture">
      <input
        className="review-capture-input"
        value={draft}
        placeholder={t('review.capture.placeholder')}
        aria-label={t('review.capture.placeholder')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
      />
      {added.length > 0 && (
        <div className="review-captured">
          <h2 className="group-title">{t('review.capture.added', { n: added.length })}</h2>
          <ul>
            {added.map((title, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: titles may repeat; the list only grows
              <li key={i}>{title}</li>
            ))}
          </ul>
        </div>
      )}
      {triggers && (
        <div className="review-triggers">
          <h2 className="group-title">{t('review.triggers.title')}</h2>
          <ul>
            {TRIGGERS.map((n) => (
              <li key={n}>{t(`review.trigger.${n}` as MessageKey)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// --- Look back, Overdue and upcoming ---

function LookBackStep(props: { tasks: Task[]; projects: Project[]; perArea: AreaCount[] }) {
  const t = useT()
  const ws = useWorkspace()
  const { taskList, group } = useStepTasks(props.tasks)
  if (props.tasks.length === 0 && props.projects.length === 0) {
    return <p className="empty">{t('review.lookBack.none')}</p>
  }
  return (
    <>
      <ul className="review-counts">
        {props.perArea.map(({ areaId, count }) => {
          const area = areaId ? ws.areaById.get(areaId) : undefined
          return (
            <li key={areaId ?? 'none'}>
              {area && <AreaGlyph icon={area.icon} color={area.color} size={15} />}
              <span>{area ? area.title || t('area.untitled') : t('project.noArea')}</span>
              <strong>{count}</strong>
            </li>
          )
        })}
      </ul>
      {props.projects.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('list.projects')}</h2>
          <ul className="tasks">
            {props.projects.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        </div>
      )}
      {props.tasks.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('review.lookBack.tasks', { n: props.tasks.length })}</h2>
          {group('done', props.tasks, { showCaption: true })}
        </div>
      )}
      <TaskToolbar list={taskList} />
      {taskList.panel}
    </>
  )
}

function DueSoonStep(props: { tasks: Task[]; projects: Project[] }) {
  const t = useT()
  const { shown, taskList, group } = useStepTasks(props.tasks)
  return (
    <>
      {shown.length === 0 && props.projects.length === 0 && (
        <p className="empty">{t('review.dueSoon.none')}</p>
      )}
      {props.projects.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('list.projects')}</h2>
          <ul className="tasks">
            {props.projects.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        </div>
      )}
      {shown.length > 0 && group('dated', shown, { showWhen: true, showCaption: true })}
      <TaskToolbar list={taskList} />
      {taskList.panel}
    </>
  )
}

// --- Projects and areas, one card at a time ---

function SignalChips({ list }: { list: Signal[] }) {
  const t = useT()
  if (list.length === 0) return null
  return (
    <ul className="review-signals">
      {list.map((s) => (
        <li key={s} className={`review-signal ${s}`}>
          {t(`review.signal.${s}`)}
        </li>
      ))}
    </ul>
  )
}

interface CardsProps<T extends { id: string; title: string }> {
  items: T[]
  /** Shown indented in the index, under the item before it (a project under its area). */
  nested?: (item: T) => boolean
  isDone: (item: T) => boolean
  onReviewed: (item: T) => void
  card: (item: T) => ReactNode
  icon: (item: T) => ReactNode
  untitled: string | ((item: T) => string)
  noneKey: MessageKey
  allDoneKey: MessageKey
}

/**
 * Shows one item at a time with a "Reviewed" button (shortcut R) and moves on
 * to the next one by itself. Below the card, every item with its tick, to jump.
 */
function ReviewCards<T extends { id: string; title: string }>(props: CardsProps<T>) {
  const t = useT()
  const { items, isDone, onReviewed } = props
  // null: the first one still to do. An item that leaves the list (completed,
  // to Someday, deleted) falls back to that as well.
  const [pickedId, setPickedId] = useState<string | null>(null)
  const current = items.find((i) => i.id === pickedId) ?? nextToReview(items, isDone)
  const position = current ? items.indexOf(current) + 1 : 0
  const doneCount = items.filter(isDone).length

  function reviewed(item: T) {
    onReviewed(item)
    setPickedId(nextToReview(items, isDone, item.id)?.id ?? null)
    document.querySelector('.content')?.scrollTo({ top: 0 })
  }

  // R ticks off the card on screen, outside text fields and menus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'r' || e.metaKey || e.ctrlKey || e.altKey || !current) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [role="dialog"], [role="menu"]')) return
      e.preventDefault()
      reviewed(current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (items.length === 0) return <p className="empty">{t(props.noneKey)}</p>

  return (
    <>
      {current ? (
        <article className={`review-card ${isDone(current) ? 'done' : ''}`}>
          <p className="review-card-count muted">
            {t('review.position', { n: position, total: items.length })}
          </p>
          {props.card(current)}
          <div className="review-card-actions">
            <button type="button" onClick={() => reviewed(current)}>
              <Check size={16} strokeWidth={2.4} aria-hidden="true" />
              {t('review.markReviewed')}
            </button>
            <span className="muted review-shortcut">{t('review.shortcut')}</span>
          </div>
        </article>
      ) : (
        <p className="empty review-empty">
          <Check size={16} className="review-ok" aria-hidden="true" /> {t(props.allDoneKey)}
        </p>
      )}
      <h2 className="group-title">
        {t('review.reviewedCount', { n: doneCount, total: items.length })}
      </h2>
      <ol className="review-index">
        {items.map((item) => (
          <li key={item.id} className={props.nested?.(item) ? 'nested' : undefined}>
            <button
              type="button"
              className={`review-index-item ${item.id === current?.id ? 'current' : ''} ${
                isDone(item) ? 'done' : ''
              }`}
              onClick={() => setPickedId(item.id)}
            >
              <span className="review-tick" aria-hidden="true">
                {isDone(item) && <Check size={12} strokeWidth={3} />}
              </span>
              {props.icon(item)}
              <span className="review-index-title">
                {item.title ||
                  (typeof props.untitled === 'string' ? props.untitled : props.untitled(item))}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}

const now = () => new Date().toISOString()

type StepItem =
  | { kind: 'area'; id: string; title: string; area: Area; group: AreaProjects }
  | { kind: 'project'; id: string; title: string; project: Project; nested: boolean }

/**
 * Areas and projects in one walk: per area a card for the area itself, then a card for each
 * of its projects; the projects without an area come last.
 */
function AreasAndProjectsStep({ review, groups }: { review: Review; groups: AreaProjects[] }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const items: StepItem[] = groups.flatMap((g): StepItem[] => [
    ...(g.area
      ? [{ kind: 'area' as const, id: g.area.id, title: g.area.title, area: g.area, group: g }]
      : []),
    ...g.projects.map((p) => ({
      kind: 'project' as const,
      id: p.id,
      title: p.title,
      project: p,
      nested: g.area !== null,
    })),
  ])
  const untitled = (item: StepItem) =>
    item.kind === 'area' ? t('area.untitled') : t('project.untitled')
  return (
    <ReviewCards
      items={items}
      nested={(item) => item.kind === 'project' && item.nested}
      isDone={(item) => isReviewedIn(item.kind === 'area' ? item.area : item.project, review)}
      onReviewed={(item) => engine.mutate(item.kind, item.id, { reviewedAt: now() })}
      card={(item) =>
        item.kind === 'area' ? (
          <AreaCard
            key={item.id}
            item={{ area: item.area, tasks: item.group.tasks, projects: item.group.allProjects }}
            deep={false}
          />
        ) : (
          <ProjectCard key={item.id} project={item.project} />
        )
      }
      icon={(item) =>
        item.kind === 'area' ? (
          <AreaGlyph icon={item.area.icon} color={item.area.color} size={14} />
        ) : (
          <ProgressCircle value={views.progress(item.id, ws.tasks)} size={14} />
        )
      }
      untitled={(item) => untitled(item)}
      noneKey="review.areasAndProjects.none"
      allDoneKey="review.areasAndProjects.allDone"
    />
  )
}

function ProjectCard({ project }: { project: Project }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const all = views.projectTasks(ws.tasks, project.id)
  const open = all.filter((task) => task.status === 'open')
  const { shown, taskList } = useStepTasks(open)
  const area = project.areaId ? ws.areaById.get(project.areaId) : undefined
  // The same order as the project's page: loose tasks first, then per heading.
  const headings = views.headingsOf(ws.headings, project.id)
  const sections = projectSections(all, shown, headings)
  const group = (headingId: string | null, tasks: Task[], header?: ReactNode) => (
    <TaskGroup
      group={{
        key: `review:project:${project.id}:${headingId ?? 'root'}`,
        target: { kind: 'project', projectId: project.id, headingId },
      }}
      tasks={tasks}
      rowProps={(task) => taskList.rowProps(task, { showWhen: true })}
      header={header}
    />
  )

  function removeHeading(heading: Heading) {
    for (const task of all) {
      if (task.headingId === heading.id) engine.mutate('task', task.id, { headingId: null })
    }
    engine.mutate('heading', heading.id, { deleted: true })
  }

  function addTask() {
    const task = newTask({
      title: '',
      projectId: project.id,
      when: { kind: 'anytime' },
      order: orderBetween(sections.loose.at(-1)?.order ?? null, null),
    })
    engine.create('task', task)
    taskList.openNew(task.id)
  }

  return (
    <>
      <header className="review-card-head">
        <span className="review-card-icon">
          <ProgressCircle value={views.progress(project.id, ws.tasks)} size={22} />
        </span>
        <div className="review-card-title">
          <button type="button" className="link" onClick={() => navigate(projectPath(project.id))}>
            {project.title || t('project.untitled')}
          </button>
          {area && <span className="muted">{area.title || t('area.untitled')}</span>}
        </div>
        <MoreMenu
          alignEnd
          label={t('menu.projectActions')}
          items={[
            { label: t('project.complete'), onSelect: () => toggleProject(engine, project) },
            {
              label: t('review.toSomeday'),
              onSelect: () => engine.mutate('project', project.id, { when: { kind: 'someday' } }),
            },
            {
              label: t('project.delete'),
              danger: true,
              confirm: t('project.deleteQuestion'),
              onSelect: () => deleteProject(engine, ws, project),
            },
          ]}
        />
      </header>
      <p className="review-card-question">{t('review.project.outcome')}</p>
      <SignalChips list={signals(project, ws, ws.today)} />
      {project.notes && (
        <p className="review-card-notes">
          <LinkedText text={project.notes} />
        </p>
      )}
      {shown.length === 0 && headings.length === 0 && (
        <p className="empty">{t('review.card.noTasks')}</p>
      )}
      {group(null, sections.loose)}
      {sections.headings.map(({ heading, tasks }) => (
        <div key={heading.id} className="group heading-group">
          {group(
            heading.id,
            tasks,
            <HeadingRow heading={heading} onRemove={() => removeHeading(heading)} />,
          )}
        </div>
      ))}
      <TaskToolbar onNew={addTask} list={taskList} />
      {taskList.panel}
    </>
  )
}

function AreasStep(props: { review: Review; areas: AreaItem[]; deep: boolean }) {
  const t = useT()
  const engine = useEngine()
  const byId = new Map(props.areas.map((a) => [a.area.id, a]))
  return (
    <ReviewCards
      items={props.areas.map((a) => a.area)}
      isDone={(a) => isReviewedIn(a, props.review)}
      onReviewed={(a) => engine.mutate('area', a.id, { reviewedAt: now() })}
      card={(a) => <AreaCard key={a.id} item={byId.get(a.id) as AreaItem} deep={props.deep} />}
      icon={(a) => <AreaGlyph icon={a.icon} color={a.color} size={14} />}
      untitled={t('area.untitled')}
      noneKey="review.areas.none"
      allDoneKey="review.areas.allDone"
    />
  )
}

function AreaCard({ item, deep }: { item: AreaItem; deep: boolean }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const { area } = item
  const { shown, taskList } = useStepTasks(item.tasks)

  function addTask() {
    const task = newTask({
      title: '',
      areaId: area.id,
      when: { kind: 'anytime' },
      order: orderBetween(item.tasks.at(-1)?.order ?? null, null),
    })
    engine.create('task', task)
    taskList.openNew(task.id)
  }

  return (
    <>
      <header className="review-card-head">
        <AreaGlyph icon={area.icon} color={area.color} size={22} className="review-card-icon" />
        <div className="review-card-title">
          <button type="button" className="link" onClick={() => navigate(areaPath(area.id))}>
            {area.title || t('area.untitled')}
          </button>
        </div>
      </header>
      <SignalChips list={signals(area, ws, ws.today)} />
      {deep && <p className="review-question">{t('review.areasDeep.question')}</p>}
      {item.projects.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('list.projects')}</h2>
          <ul className="tasks">
            {item.projects.map((p) =>
              deep ? (
                <ProjectWithActions key={p.id} project={p} />
              ) : (
                <ProjectRow key={p.id} project={p} showArea={false} />
              ),
            )}
          </ul>
        </div>
      )}
      <div className="group">
        <h2 className="group-title">{t('review.card.looseTasks')}</h2>
        {shown.length === 0 ? (
          <p className="empty">{t('review.card.noTasks')}</p>
        ) : (
          <TaskGroup
            group={{ key: `review:area:${area.id}`, target: { kind: 'area', areaId: area.id } }}
            tasks={shown}
            rowProps={(task) => taskList.rowProps(task, { showWhen: true })}
          />
        )}
      </div>
      <TaskToolbar onNew={addTask} list={taskList} />
      {taskList.panel}
    </>
  )
}

// --- Someday ---

const ANYTIME: When = { kind: 'anytime' }

/** A project row with quick actions: activate or park it, and for Someday ones keep or delete. */
function ProjectWithActions({ project, review }: { project: Project; review?: Review }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const someday = views.isSomeday(project)
  const kept = review ? isReviewedIn(project, review) : false
  const area: Area | undefined = project.areaId ? ws.areaById.get(project.areaId) : undefined
  return (
    <li className={`task project-row review-project ${kept ? 'kept' : ''}`}>
      <button type="button" className="task-main" onClick={() => navigate(projectPath(project.id))}>
        <ProgressCircle value={views.progress(project.id, ws.tasks)} className="row-progress" />
        <span className="task-text">
          <span className="task-title">{project.title || <em>{t('project.untitled')}</em>}</span>
          {area && review && <span className="task-caption">{area.title}</span>}
        </span>
      </button>
      <span className="review-row-actions">
        {review && (
          <button
            type="button"
            className={`chip small ${kept ? 'active' : ''}`}
            aria-pressed={kept}
            onClick={() => engine.mutate('project', project.id, { reviewedAt: now() })}
          >
            {t('review.keep')}
          </button>
        )}
        <button
          type="button"
          className="chip small"
          onClick={() =>
            engine.mutate('project', project.id, {
              when: someday ? ANYTIME : { kind: 'someday' },
            })
          }
        >
          {someday ? t('review.activate') : t('review.toSomeday')}
        </button>
        {review && (
          <MoreMenu
            alignEnd
            label={t('menu.projectActions')}
            items={[
              {
                label: t('project.delete'),
                danger: true,
                confirm: t('project.deleteQuestion'),
                onSelect: () => deleteProject(engine, ws, project),
              },
            ]}
          />
        )}
      </span>
    </li>
  )
}

function SomedayScanStep(props: { tasks: Task[]; projects: Project[] }) {
  const t = useT()
  const { shown, taskList, group } = useStepTasks(props.tasks)
  return (
    <>
      {shown.length === 0 && props.projects.length === 0 && (
        <p className="empty">{t('review.someday.none')}</p>
      )}
      {props.projects.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('list.projects')}</h2>
          <ul className="tasks">
            {props.projects.map((p) => (
              <ProjectWithActions key={p.id} project={p} />
            ))}
          </ul>
        </div>
      )}
      {shown.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('review.someday.tasks')}</h2>
          {group('someday', shown, { showCaption: true })}
        </div>
      )}
      <TaskToolbar list={taskList} />
      {taskList.panel}
    </>
  )
}

function SomedayDeepStep(props: { review: Review; projects: Project[]; groups: AreaGroup[] }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const { review } = props
  const areaOf = (task: Task) =>
    task.projectId ? (ws.projectById.get(task.projectId)?.areaId ?? null) : task.areaId
  const { taskList, group, where } = useStepTasks(props.groups.flatMap((g) => g.tasks))

  function toggleGroup(key: string) {
    engine.mutate('review', review.id, {
      doneSteps: review.doneSteps.includes(key)
        ? withoutDoneStep(review, key)
        : withDoneStep(review, key),
    })
  }

  return (
    <>
      {props.projects.length === 0 && props.groups.length === 0 && (
        <p className="empty">{t('review.someday.none')}</p>
      )}
      {props.projects.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('list.projects')}</h2>
          <ul className="tasks">
            {props.projects.map((p) => (
              <ProjectWithActions key={p.id} project={p} review={review} />
            ))}
          </ul>
        </div>
      )}
      {props.groups.map((g) => {
        const key = somedayGroupKey(g.areaId)
        const done = review.doneSteps.includes(key)
        const area = g.areaId ? ws.areaById.get(g.areaId) : undefined
        return (
          <div key={key} className={`group review-someday-group ${done ? 'done' : ''}`}>
            <h2 className="group-title review-group-head">
              <span>{area ? area.title || t('area.untitled') : t('review.someday.noArea')}</span>
              <button
                type="button"
                className={`chip small ${done ? 'active' : ''}`}
                aria-pressed={done}
                onClick={() => toggleGroup(key)}
              >
                {done && <Check size={12} strokeWidth={3} aria-hidden="true" />}
                {t('review.groupDone')}
              </button>
            </h2>
            {group(
              key,
              where((task) => areaOf(task) === g.areaId),
            )}
          </div>
        )
      })}
      <TaskToolbar list={taskList} />
      {taskList.panel}
    </>
  )
}
