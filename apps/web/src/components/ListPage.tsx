import { type Daypart, type Project, type Task, views } from '@dingen/core'
import { Focus } from 'lucide-react'
import { useState } from 'react'
import { filterAreas, filterByArea, setTodayArea, useTodayArea } from '../areaFilter.js'
import { daysWithEvents, rangeFor, useCalendarData } from '../calendar.js'
import { listTarget, type TaskGroupInfo } from '../dnd.js'
import { filterByDuration, hasDurationFilter, useDurationFilter } from '../duration.js'
import { type MessageKey, useT } from '../i18n/index.js'
import {
  addDays,
  completedDate,
  containerGroups,
  describeDate,
  describeLongDate,
  groupKeyOf,
  type ListDef,
  listProjects,
  listTasks,
} from '../lists.js'
import { setFocusMode, setTodayView, useFocusMode, useTodayView } from '../prefs.js'
import { areaPath, navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { createInboxTask, type MoveTarget, useLinger } from '../taskActions.js'
import { markTodaySeen, newInToday, useTodaySeen, whenSetOn } from '../todaySeen.js'
import { DayEvents } from './CalendarEvents.js'
import { EmptyState } from './EmptyState.js'
import { MoreMenu } from './Menu.js'
import {
  ActiveFilters,
  FilterButton,
  HeaderButton,
  type PageFilters,
  PageHeader,
} from './PageHeader.js'
import { ProjectRow } from './ProjectRow.js'
import { TaskGroup } from './TaskGroup.js'
import type { RowProps } from './TaskRow.js'
import { TodayBody, TodayTotal } from './TodayBody.js'
import { TaskToolbar } from './Toolbar.js'
import { useOnSignal, useTaskList } from './useTaskList.js'

interface Props {
  list: ListDef
  focusSignal: number
  /** Under the title (the Logbook puts its own filters there). */
  below?: React.ReactNode
  /** More filters for the filter popover (the Logbook's kinds, people and period). */
  extraFilters?: React.ReactNode
  extraFiltersActive?: boolean
}

export function ListPage({
  list,
  focusSignal,
  below,
  extraFilters,
  extraFiltersActive = false,
}: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const todayView = useTodayView()
  const focus = useFocusMode() && list.id === 'today'
  const calendar = useCalendarData()
  const maxDuration = useDurationFilter(list.id)

  const visible = listTasks(list.id, ws)
  const seen = useTodaySeen()
  const fresh =
    list.id === 'today' ? newInToday(visible, (x) => whenSetOn(engine, x), ws.today, seen) : []
  const freshIds = new Set(fresh.map((x) => x.id))
  const inbox = list.id === 'inbox'
  const { shown: all, toggle } = useLinger(
    visible,
    ws,
    engine,
    list.id === 'today' ? views.byTodayOrder : views.byOrder,
  )
  // Today can be narrowed to one area (kept per device); an area that is gone filters nothing.
  const storedArea = useTodayArea()
  const areaFilter =
    list.id === 'today' && storedArea && ws.areaById.has(storedArea) ? storedArea : null
  const inArea = filterByArea(all, areaFilter, ws)
  const present = new Set(filterByArea(visible, areaFilter, ws).flatMap((task) => task.tagIds))
  const tagged = tagFilter ? inArea.filter((task) => task.tagIds.includes(tagFilter)) : inArea
  const shown = filterByDuration(tagged, maxDuration)
  // The duration filter shows once a task here has a duration, or while it is on.
  const filters: PageFilters = {
    present,
    tag: tagFilter,
    onTag: setTagFilter,
    durationList:
      hasDurationFilter(list.id) &&
      (maxDuration !== null || visible.some((task) => task.duration !== null))
        ? list.id
        : null,
    maxDuration,
  }
  const listed = listProjects(list.id, ws)
  if (list.id === 'today') {
    filters.areas = filterAreas(visible, listed, areaFilter, ws)
    filters.area = areaFilter
    filters.onArea = setTodayArea
  }
  const projects = areaFilter ? listed.filter((p) => p.areaId === areaFilter) : listed

  // A new task goes to the Inbox, from any list (a project or area page adds to itself); the panel keeps it open here.
  const taskList = useTaskList(shown, toggle, () => createInboxTask(engine, ws, tagFilter))
  const addNew = taskList.addNew

  // `n` anywhere in the window adds a task.
  useOnSignal(focusSignal, addNew)

  const rowProps = (
    task: Task,
    showCaption = list.id !== 'anytime' && list.id !== 'someday',
  ): RowProps =>
    taskList.rowProps(task, {
      showCaption,
      isNew: freshIds.has(task.id),
      // In the Inbox a task can already have a date; show it.
      showWhen: inbox,
      showDaypart: list.id === 'upcoming',
    })
  const group = (
    key: string,
    target: MoveTarget | null,
    tasks: Task[],
    orderField: TaskGroupInfo['orderField'] = 'order',
    showCaption?: boolean,
    daypart?: Daypart | null,
  ) => (
    <TaskGroup
      group={{ key: `${list.id}:${key}`, target, orderField, daypart } satisfies TaskGroupInfo}
      tasks={tasks}
      rowProps={(task) => rowProps(task, showCaption)}
      frozen={list.id === 'logbook'}
    />
  )
  const projectRow = (p: Project) => <ProjectRow key={p.id} project={p} />

  let body: React.ReactNode
  switch (list.id) {
    case 'today':
      body = (
        <TodayBody
          today={ws.today}
          tasks={shown}
          view={todayView}
          focus={focus}
          area={areaFilter}
          projects={projects.length > 0 && <ul className="tasks">{projects.map(projectRow)}</ul>}
          group={group}
          groupByContainer={groupByContainer}
        />
      )
      break
    case 'upcoming':
      // A task that was just checked off lingers in its group; it has no upcoming date any more.
      body = withEventDays(
        groupByDate(
          shown,
          projects,
          (item) =>
            views.upcomingDate(item, ws.today) ??
            (item.when.kind === 'date' ? item.when.date : (item.deadline ?? ws.today)),
        ),
        // Afspraken vanaf morgen; vandaag staat in Vandaag.
        daysWithEvents(calendar.events, addDays(ws.today, 1), rangeFor(ws.today).to),
      ).map((g) => (
        <div key={g.date} className="group">
          <h2 className="group-title">{describeDate(g.date, ws.today)}</h2>
          <DayEvents date={g.date} />
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

  const isToday = list.id === 'today'
  return (
    <section className={`list-page ${list.id}`}>
      <PageHeader
        title={<h1>{t(list.titleKey)}</h1>}
        subtitle={
          isToday && (
            <>
              {describeLongDate(ws.today)}
              <TodayTotal tasks={shown} />
            </>
          )
        }
        actions={
          <>
            <FilterButton {...filters} extra={extraFilters} extraActive={extraFiltersActive} />
            {isToday && (
              <HeaderButton
                icon={Focus}
                label={t('today.focus')}
                hint={t('today.focus.hint')}
                pressed={focus}
                onClick={() => setFocusMode(!focus)}
              />
            )}
            {isToday && (
              <MoreMenu
                alignEnd
                label={t('today.view')}
                items={(['manual', 'grouped'] as const).map((view) => ({
                  label: t(`today.view.${view}`),
                  checked: todayView === view,
                  onSelect: () => setTodayView(view),
                }))}
              />
            )}
          </>
        }
      >
        <ActiveFilters {...filters} />
        {below}
      </PageHeader>
      {isToday && fresh.length > 0 && (
        <div className="notice-banner today-new-banner">
          <span className="task-new-dot" aria-hidden="true" />
          <span className="notice-banner-text">
            {fresh.length === 1 ? t('today.new.one') : t('today.new.other', { n: fresh.length })}
          </span>
          <button type="button" className="chip small" onClick={() => void markTodaySeen(ws.today)}>
            {t('today.new.ok')}
          </button>
        </div>
      )}
      {shown.length === 0 && projects.length === 0 && (
        <EmptyState
          title={t(`list.empty.${list.id}` as MessageKey)}
          text={t(`list.emptyHint.${list.id}` as MessageKey)}
        />
      )}
      {body}
      <TaskToolbar onNew={addNew} list={taskList} />
      {taskList.panel}
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

/** Voegt lege dagen toe voor dagen met alleen afspraken, op datum gesorteerd. */
function withEventDays(groups: DateGroup[], eventDays: string[]): DateGroup[] {
  const have = new Set(groups.map((g) => g.date))
  const extra = eventDays
    .filter((date) => !have.has(date))
    .map((date) => ({ date, tasks: [], projects: [] }))
  return [...groups, ...extra].sort((a, b) => a.date.localeCompare(b.date))
}
