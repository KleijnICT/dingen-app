import { newTask, orderBetween, type Project, type Task } from '@dingen/core'
import { useState } from 'react'
import { type MessageKey, useT } from '../i18n/index.js'
import {
  containerGroups,
  describeDate,
  describeLongDate,
  groupKeyOf,
  type ListDef,
  listProjects,
  listTasks,
} from '../lists.js'
import { areaPath, navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { useLinger } from '../taskActions.js'
import { ProjectRow } from './ProjectRow.js'
import { QuickAdd } from './QuickAdd.js'
import { TagFilter } from './TagFilter.js'
import { TaskRow } from './TaskRow.js'

interface Props {
  list: ListDef
  focusSignal: number
}

export function ListPage({ list, focusSignal }: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const [openId, setOpenId] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  const visible = listTasks(list.id, ws)
  const { shown: all, toggle } = useLinger(visible, ws.tasks, engine)
  const present = new Set(visible.flatMap((task) => task.tagIds))
  const shown = tagFilter ? all.filter((task) => task.tagIds.includes(tagFilter)) : all
  const projects = listProjects(list.id, ws)

  function add(title: string) {
    const when = list.newWhen(ws.today)
    if (!when) return
    const last = visible.at(-1)
    engine.create(
      'task',
      newTask({
        title,
        when,
        tagIds: tagFilter ? [tagFilter] : [],
        order: orderBetween(last?.order ?? null, null),
      }),
    )
  }

  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      open={openId === task.id}
      showWhen={false}
      showCaption={list.id !== 'anytime' && list.id !== 'someday'}
      onOpen={() => setOpenId(task.id)}
      onClose={() => setOpenId(null)}
      onToggle={() => toggle(task)}
    />
  )
  const projectRow = (p: Project) => <ProjectRow key={p.id} project={p} />

  let body: React.ReactNode
  switch (list.id) {
    case 'today': {
      const evening = shown.filter((task) => task.evening)
      const day = shown.filter((task) => !task.evening)
      body = (
        <>
          <ul className="tasks">
            {projects.map(projectRow)}
            {day.map(row)}
          </ul>
          {evening.length > 0 && (
            <div className="group evening">
              <h2 className="group-title">{t('list.thisEvening')}</h2>
              <ul className="tasks">{evening.map(row)}</ul>
            </div>
          )}
        </>
      )
      break
    }
    case 'upcoming':
      body = groupByDate(shown, projects, (item) =>
        item.when.kind === 'date' ? item.when.date : '',
      ).map((g) => (
        <div key={g.date} className="group">
          <h2 className="group-title">{describeDate(g.date, ws.today)}</h2>
          <ul className="tasks">
            {g.projects.map(projectRow)}
            {g.tasks.map(row)}
          </ul>
        </div>
      ))
      break
    case 'logbook':
      body = groupByDate(
        shown,
        projects,
        (item) => (item.completedAt ?? '').slice(0, 10),
        true,
      ).map((g) => (
        <div key={g.date} className="group">
          <h2 className="group-title">{describeDate(g.date, ws.today)}</h2>
          <ul className="tasks">
            {[
              ...g.projects.map((p) => ({ at: p.completedAt ?? '', node: projectRow(p) })),
              ...g.tasks.map((task) => ({ at: task.completedAt ?? '', node: row(task) })),
            ]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((x) => x.node)}
          </ul>
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
              <ul className="tasks">{g.tasks.map(row)}</ul>
            </div>
          ))}
        </>
      )
      break
    default:
      body = <ul className="tasks">{shown.map(row)}</ul>
  }

  function groupByContainer(tasks: Task[]) {
    const byKey = new Map<string, Task[]>()
    for (const task of tasks) {
      const key = groupKeyOf(task)
      byKey.set(key, [...(byKey.get(key) ?? []), task])
    }
    const groups: { key: string; title: string; href: string; tasks: Task[] }[] = []
    const loose = byKey.get('none')
    if (loose) groups.push({ key: 'none', title: '', href: '', tasks: loose })
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
            }
          : {
              key: g.key,
              title: g.area?.title || t('area.untitled'),
              href: areaPath(g.area?.id ?? ''),
              tasks: items,
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
      </header>
      {list.newWhen(ws.today) && <QuickAdd onAdd={add} focusSignal={focusSignal} />}
      <TagFilter present={present} active={tagFilter} onChange={setTagFilter} />
      {shown.length === 0 && projects.length === 0 && (
        <p className="empty">{t(`list.empty.${list.id}` as MessageKey)}</p>
      )}
      {body}
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
