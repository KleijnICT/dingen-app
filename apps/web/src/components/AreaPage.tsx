import { type Area, newProject, newTask, orderBetween, type Task, views } from '@dingen/core'
import { CirclePlus } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../i18n/index.js'
import { completedDate } from '../lists.js'
import { navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { deleteArea, useLinger } from '../taskActions.js'
import { AreaAppearance } from './AreaAppearance.js'
import { InlineInput } from './InlineInput.js'
import { MoreMenu } from './Menu.js'
import { ProjectRow } from './ProjectRow.js'
import { TagFilter } from './TagFilter.js'
import { TaskGroup } from './TaskGroup.js'
import type { RowProps } from './TaskRow.js'
import { TaskToolbar, ToolbarButton } from './Toolbar.js'
import { useOnSignal, useTaskList } from './useTaskList.js'

interface Props {
  area: Area
  focusSignal: number
}

export function AreaPage({ area, focusSignal }: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const all = views.areaTasks(ws.tasks, area.id)
  const open = all.filter((task) => task.status === 'open')
  const completed = all.filter((task) => task.status !== 'open')
  const { shown, toggle } = useLinger(open, ws, engine)
  const lingering = new Set(shown.map((task) => task.id))
  const completedToday = completed
    .filter((task) => completedDate(task) === ws.today && !lingering.has(task.id))
    .sort(views.byCompletedDesc)
  const completedEarlier = completed
    .filter((task) => completedDate(task) !== ws.today)
    .sort(views.byCompletedDesc)
  const completedShown = showCompleted ? [...completedToday, ...completedEarlier] : completedToday
  const present = new Set(open.flatMap((task) => task.tagIds))
  const filtered = tagFilter ? shown.filter((task) => task.tagIds.includes(tagFilter)) : shown
  const projects = views.projectsOf(ws.projects, area.id)

  const taskList = useTaskList([...shown, ...completedShown], toggle)

  function addNew() {
    const task = newTask({
      title: '',
      areaId: area.id,
      when: { kind: 'anytime' },
      tagIds: tagFilter ? [tagFilter] : [],
      order: orderBetween(open.at(-1)?.order ?? null, null),
    })
    engine.create('task', task)
    taskList.openNew(task.id)
  }
  useOnSignal(focusSignal, addNew)

  const rowProps = (task: Task): RowProps => taskList.rowProps(task, { showWhen: true })

  function addProject() {
    const project = newProject({
      title: '',
      areaId: area.id,
      order: orderBetween(projects.at(-1)?.order ?? null, null),
    })
    engine.create('project', project)
    navigate(projectPath(project.id))
  }

  /** Deleting an area takes everything in it along. */
  function remove() {
    deleteArea(engine, ws, area)
    navigate('/anytime')
  }

  return (
    <section className="list-page area">
      <header className="list-header project-header">
        <AreaAppearance area={area} />
        <InlineInput
          className="title-input"
          value={area.title}
          placeholder={t('area.untitled')}
          aria-label={t('area.title')}
          autoFocus={area.title === ''}
          onCommit={(title) => engine.mutate('area', area.id, { title })}
        />
        <MoreMenu
          label={t('menu.areaActions')}
          items={[
            { label: t('nav.newProject'), onSelect: addProject },
            {
              label: t('area.delete'),
              danger: true,
              confirm: t('area.deleteQuestion'),
              onSelect: remove,
            },
          ]}
        />
      </header>
      <TagFilter present={present} active={tagFilter} onChange={setTagFilter} />
      {all.length === 0 && projects.length === 0 && <p className="empty">{t('area.empty')}</p>}
      <TaskGroup
        group={{ key: `area:${area.id}`, target: { kind: 'area', areaId: area.id } }}
        tasks={filtered}
        rowProps={rowProps}
      />
      {completedShown.length > 0 && (
        <TaskGroup
          className="completed"
          group={{ key: `area:${area.id}:completed`, target: null }}
          tasks={completedShown}
          rowProps={rowProps}
          frozen
        />
      )}
      {projects.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('list.projects')}</h2>
          <ul className="tasks">
            {projects.map((p) => (
              <ProjectRow key={p.id} project={p} showArea={false} />
            ))}
          </ul>
        </div>
      )}
      {completedEarlier.length > 0 && (
        <div className="page-actions">
          <button type="button" className="link" onClick={() => setShowCompleted((c) => !c)}>
            {showCompleted
              ? t('project.hideCompleted')
              : t('project.showCompleted', { n: completedEarlier.length })}
          </button>
        </div>
      )}
      <TaskToolbar
        onNew={addNew}
        extra={<ToolbarButton icon={CirclePlus} label={t('nav.newProject')} onClick={addProject} />}
        selected={taskList.selected}
      />
    </section>
  )
}
