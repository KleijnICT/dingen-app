import {
  type Area,
  type AreaCount,
  type AreaGroup,
  type AreaItem,
  isReviewedIn,
  newTask,
  orderBetween,
  type Project,
  type Review,
  type ReviewStepId,
  reviewItems,
  type Signal,
  signals,
  somedayGroupKey,
  type Task,
  views,
  type When,
} from '@dingen/core'
import { Check } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { type MessageKey, useT } from '../i18n/index.js'
import { nextToReview, withDoneStep, withoutDoneStep } from '../reviewFlow.js'
import { areaPath, navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { deleteProject, toggleProject, useLinger } from '../taskActions.js'
import { AreaGlyph } from './AreaIcons.js'
import { ProgressCircle } from './Icons.js'
import { MoreMenu } from './Menu.js'
import { ProjectRow } from './ProjectRow.js'
import { TaskGroup } from './TaskGroup.js'
import type { RowProps } from './TaskRow.js'
import { TaskToolbar } from './Toolbar.js'
import { useTaskList } from './useTaskList.js'

interface StepProps {
  review: Review
  stepId: ReviewStepId
}

/** The body of one review step; what it shows comes from `reviewItems` in core. */
export function ReviewStepView({ review, stepId }: StepProps) {
  const ws = useWorkspace()
  const items = reviewItems(stepId, ws, ws.today)
  switch (items.kind) {
    case 'none':
      return <CaptureStep triggers={stepId === 'triggers'} />
    case 'tasks':
      return (
        <TasksStep
          tasks={items.tasks}
          emptyKey={stepId === 'inbox' ? 'review.inbox.empty' : 'review.loose.none'}
          showWhen={stepId !== 'inbox'}
        />
      )
    case 'logbook':
      return <LookBackStep tasks={items.tasks} projects={items.projects} perArea={items.perArea} />
    case 'dated':
      return <DueSoonStep tasks={items.tasks} projects={items.projects} />
    case 'projects':
      return <ProjectsStep review={review} projects={items.projects} />
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

function TasksStep(props: { tasks: Task[]; emptyKey: MessageKey; showWhen: boolean }) {
  const t = useT()
  const { shown, taskList, group } = useStepTasks(props.tasks)
  return (
    <>
      {shown.length === 0 ? (
        <p className="empty review-empty">
          <Check size={16} className="review-ok" aria-hidden="true" /> {t(props.emptyKey)}
        </p>
      ) : (
        group('tasks', shown, { showWhen: props.showWhen, showCaption: true })
      )}
      <TaskToolbar selected={taskList.selected} />
      {taskList.panel}
    </>
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
      <TaskToolbar selected={taskList.selected} />
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
      <TaskToolbar selected={taskList.selected} />
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
  isDone: (item: T) => boolean
  onReviewed: (item: T) => void
  card: (item: T) => ReactNode
  icon: (item: T) => ReactNode
  untitled: string
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
          <li key={item.id}>
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
              <span className="review-index-title">{item.title || props.untitled}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}

const now = () => new Date().toISOString()

function ProjectsStep({ review, projects }: { review: Review; projects: Project[] }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  return (
    <ReviewCards
      items={projects}
      isDone={(p) => isReviewedIn(p, review)}
      onReviewed={(p) => engine.mutate('project', p.id, { reviewedAt: now() })}
      card={(p) => <ProjectCard key={p.id} project={p} />}
      icon={(p) => <ProgressCircle value={views.progress(p.id, ws.tasks)} size={14} />}
      untitled={t('project.untitled')}
      noneKey="review.projects.none"
      allDoneKey="review.projects.allDone"
    />
  )
}

function ProjectCard({ project }: { project: Project }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const open = views.projectTasks(ws.tasks, project.id).filter((task) => task.status === 'open')
  const { shown, taskList, group } = useStepTasks(open)
  const area = project.areaId ? ws.areaById.get(project.areaId) : undefined

  function addTask() {
    const task = newTask({
      title: '',
      projectId: project.id,
      when: { kind: 'anytime' },
      order: orderBetween(open.at(-1)?.order ?? null, null),
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
      <SignalChips list={signals(project, ws, ws.today)} />
      {project.notes && <p className="review-card-notes">{project.notes}</p>}
      {shown.length === 0 ? (
        <p className="empty">{t('review.card.noTasks')}</p>
      ) : (
        group(`project:${project.id}`, shown, { showWhen: true })
      )}
      <TaskToolbar onNew={addTask} selected={taskList.selected} />
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
  const { shown, taskList, group } = useStepTasks(item.tasks)

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
          group(`area:${area.id}`, shown, { showWhen: true })
        )}
      </div>
      <TaskToolbar onNew={addTask} selected={taskList.selected} />
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
      <TaskToolbar selected={taskList.selected} />
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
      <TaskToolbar selected={taskList.selected} />
      {taskList.panel}
    </>
  )
}
