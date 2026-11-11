import { newTask, orderBetween, type Project, type Task, views } from '@dingen/core'
import { useDndContext } from '@dnd-kit/core'
import { useState } from 'react'
import { listTarget, type TaskGroupInfo } from '../dnd.js'
import { type MessageKey, useT } from '../i18n/index.js'
import {
  completedDate,
  containerGroups,
  describeDate,
  describeLongDate,
  groupKeyOf,
  type ListDef,
  listProjects,
  listTasks,
} from '../lists.js'
import { setTodayView, useTodayView } from '../prefs.js'
import { areaPath, navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { type MoveTarget, useLinger } from '../taskActions.js'
import { ProjectRow } from './ProjectRow.js'
import { ReviewBanner } from './ReviewBanner.js'
import { TagFilter } from './TagFilter.js'
import { TaskGroup } from './TaskGroup.js'
import type { RowProps } from './TaskRow.js'
import { TaskToolbar } from './Toolbar.js'
import { useOnSignal, useTaskList } from './useTaskList.js'

interface Props {
  list: ListDef
  focusSignal: number
}

export function ListPage({ list, focusSignal }: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const draggingSomething = useDndContext().active !== null
  const todayView = useTodayView()

  const visible = listTasks(list.id, ws)
  const { shown: all, toggle } = useLinger(
    visible,
    ws,
    engine,
    list.id === 'today' ? views.byTodayOrder : views.byOrder,
  )
  const present = new Set(visible.flatMap((task) => task.tagIds))
  const shown = tagFilter ? all.filter((task) => task.tagIds.includes(tagFilter)) : all
  const projects = listProjects(list.id, ws)

  const taskList = useTaskList(shown, toggle)
  const canAdd = list.newWhen(ws.today) !== null

  function addNew() {
    const when = list.newWhen(ws.today)
    if (!when) return
    const last = visible.at(-1)
    const task = newTask({
      title: '',
      when,
      tagIds: tagFilter ? [tagFilter] : [],
      order: orderBetween(last?.order ?? null, null),
    })
    engine.create('task', task)
    taskList.openNew(task.id)
  }

  // `n` anywhere in the window adds a task here.
  useOnSignal(focusSignal, addNew)

  const rowProps = (
    task: Task,
    showCaption = list.id !== 'anytime' && list.id !== 'someday',
  ): RowProps => taskList.rowProps(task, { showCaption })
  const group = (
    key: string,
    target: MoveTarget | null,
    tasks: Task[],
    orderField: TaskGroupInfo['orderField'] = 'order',
    showCaption?: boolean,
  ) => (
    <TaskGroup
      group={{ key: `${list.id}:${key}`, target, orderField } satisfies TaskGroupInfo}
      tasks={tasks}
      rowProps={(task) => rowProps(task, showCaption)}
      frozen={list.id === 'logbook'}
    />
  )
  const projectRow = (p: Project) => <ProjectRow key={p.id} project={p} />

  let body: React.ReactNode
  switch (list.id) {
    case 'today': {
      const evening = shown.filter((task) => task.evening)
      const day = shown.filter((task) => !task.evening)
      const todayWhen = { kind: 'date', date: ws.today } as const
      // "My order" is one flat list with its own order; "By project" follows each project's order.
      const dayBody =
        todayView === 'manual'
          ? group('day', { kind: 'when', when: todayWhen, evening: false }, day, 'todayOrder')
          : groupByContainer([...day].sort(views.byOrder)).map((g) => (
              <div key={g.key} className="group">
                {g.key !== 'none' && (
                  <h2 className="group-title">
                    <button type="button" className="group-link" onClick={() => navigate(g.href)}>
                      {g.title}
                    </button>
                  </h2>
                )}
                {group(g.key, g.target, g.tasks, 'order', false)}
              </div>
            ))
      body = (
        <>
          {projects.length > 0 && <ul className="tasks">{projects.map(projectRow)}</ul>}
          {dayBody}
          <div className="group evening">
            {(evening.length > 0 || draggingSomething) && (
              <h2 className="group-title">{t('list.thisEvening')}</h2>
            )}
            {group(
              'evening',
              { kind: 'when', when: todayWhen, evening: true },
              evening,
              'todayOrder',
            )}
          </div>
        </>
      )
      break
    }
    case 'upcoming':
      // A task that was just checked off lingers in its group; it has no upcoming date any more.
      body = groupByDate(
        shown,
        projects,
        (item) =>
          views.upcomingDate(item, ws.today) ??
          (item.when.kind === 'date' ? item.when.date : (item.deadline ?? ws.today)),
      ).map((g) => (
        <div key={g.date} className="group">
          <h2 className="group-title">{describeDate(g.date, ws.today)}</h2>
          {g.projects.length > 0 && <ul className="tasks">{g.projects.map(projectRow)}</ul>}
          {group(`date:${g.date}`, { kind: 'when', when: { kind: 'date', date: g.date } }, g.tasks)}
        </div>
      ))
      break
    case 'logbook':
      body = groupByDate(shown, projects, completedDate, true).map((g) => (
        <div key={g.date} className="group">
          <h2 className="group-title">{describeDate(g.date, ws.today)}</h2>
          {g.projects.length > 0 && <ul className="tasks">{g.projects.map(projectRow)}</ul>}
          {group(`done:${g.date}`, null, [...g.tasks].sort(views.byCompletedDesc))}
        </div>
      ))
      break
    case 'anytime':
    case 'someday':
      body = (
        <>
          {projects.length > 0 && (
            <div className="group">
              <h2 className="group-title">{t('list.projects')}</h2>
              <ul className="tasks">{projects.map(projectRow)}</ul>
            </div>
          )}
          {groupByContainer(shown).map((g) => (
            <div key={g.key} className="group">
              {g.key !== 'none' && (
                <h2 className="group-title">
                  <button type="button" className="group-link" onClick={() => navigate(g.href)}>
                    {g.title}
                  </button>
                </h2>
              )}
              {group(g.key, g.target, g.tasks)}
            </div>
          ))}
        </>
      )
      break
    default:
      body = group('all', listTarget(list.id, ws.today), shown)
  }

  function groupByContainer(tasks: Task[]) {
    const byKey = new Map<string, Task[]>()
    for (const task of tasks) {
      const key = groupKeyOf(task)
      byKey.set(key, [...(byKey.get(key) ?? []), task])
    }
    const groups: {
      key: string
      title: string
      href: string
      tasks: Task[]
      target: MoveTarget
    }[] = []
    const loose = byKey.get('none')
    if (loose)
      groups.push({ key: 'none', title: '', href: '', tasks: loose, target: { kind: 'none' } })
    for (const g of containerGroups(ws)) {
      const items = byKey.get(g.key)
      if (!items) continue
      groups.push(
        g.project
          ? {
              key: g.key,
              title: g.project.title || t('project.untitled'),
              href: projectPath(g.project.id),
              tasks: items,
              target: { kind: 'project', projectId: g.project.id },
            }
          : {
              key: g.key,
              title: g.area?.title || t('area.untitled'),
              href: areaPath(g.area?.id ?? ''),
              tasks: items,
              target: { kind: 'area', areaId: g.area?.id ?? '' },
            },
      )
    }
    return groups
  }

  return (
    <section className={`list-page ${list.id}`}>
      <header className="list-header">
        <h1>{t(list.titleKey)}</h1>
        {list.id === 'today' && <p className="muted">{describeLongDate(ws.today)}</p>}
        {list.id === 'today' && (
          <fieldset className="view-switch" aria-label={t('today.view')}>
            {(['manual', 'grouped'] as const).map((view) => (
              <button
                type="button"
                key={view}
                className={`chip small ${todayView === view ? 'active' : ''}`}
                onClick={() => setTodayView(view)}
              >
                {t(`today.view.${view}`)}
              </button>
            ))}
          </fieldset>
        )}
      </header>
      {list.id === 'today' && <ReviewBanner />}
      <TagFilter present={present} active={tagFilter} onChange={setTagFilter} />
      {shown.length === 0 && projects.length === 0 && (
        <p className="empty">{t(`list.empty.${list.id}` as MessageKey)}</p>
      )}
      {body}
      <TaskToolbar onNew={canAdd ? addNew : undefined} selected={taskList.selected} />
    </section>
  )
}

interface DateGroup {
  date: string
  tasks: Task[]
  projects: Project[]
}

function groupByDate(
  tasks: Task[],
  projects: Project[],
  dateOf: (item: Task | Project) => string,
  descending = false,
): DateGroup[] {
  const groups = new Map<string, DateGroup>()
  const get = (date: string) => {
    let g = groups.get(date)
    if (!g) {
      g = { date, tasks: [], projects: [] }
      groups.set(date, g)
    }
    return g
  }
  for (const p of projects) get(dateOf(p)).projects.push(p)
  for (const task of tasks) get(dateOf(task)).tasks.push(task)
  const sorted = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date))
  return descending ? sorted.reverse() : sorted
}
