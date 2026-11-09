import { type Area, newProject, newTask, orderBetween, views } from '@dingen/core'
import { useState } from 'react'
import { useT } from '../i18n/index.js'
import { navigate, projectPath } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { useLinger } from '../taskActions.js'
import { InlineInput } from './InlineInput.js'
import { ProjectRow } from './ProjectRow.js'
import { QuickAdd } from './QuickAdd.js'
import { TagFilter } from './TagFilter.js'
import { TaskGroup } from './TaskGroup.js'

interface Props {
  area: Area
  focusSignal: number
}

export function AreaPage({ area, focusSignal }: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const [openId, setOpenId] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  const open = views.areaTasks(ws.tasks, area.id).filter((task) => task.status === 'open')
  const { shown, toggle } = useLinger(open, ws.tasks, engine)
  const present = new Set(open.flatMap((task) => task.tagIds))
  const filtered = tagFilter ? shown.filter((task) => task.tagIds.includes(tagFilter)) : shown
  const projects = views.projectsOf(ws.projects, area.id)

  function add(title: string) {
    engine.create(
      'task',
      newTask({
        title,
        areaId: area.id,
        when: { kind: 'anytime' },
        tagIds: tagFilter ? [tagFilter] : [],
        order: orderBetween(open.at(-1)?.order ?? null, null),
      }),
    )
  }

  function addProject() {
    const project = newProject({
      title: '',
      areaId: area.id,
      order: orderBetween(projects.at(-1)?.order ?? null, null),
    })
    engine.create('project', project)
    navigate(projectPath(project.id))
  }

  /** Deleting an area keeps its projects and tasks; they just lose the area. */
  function remove() {
    for (const p of ws.projects) {
      if (p.areaId === area.id) engine.mutate('project', p.id, { areaId: null })
    }
    for (const task of ws.tasks) {
      if (task.areaId === area.id) engine.mutate('task', task.id, { areaId: null })
    }
    engine.mutate('area', area.id, { deleted: true })
    navigate('/anytime')
  }

  return (
    <section className="list-page area">
      <header className="list-header">
        <InlineInput
          className="title-input"
          value={area.title}
          placeholder={t('area.untitled')}
          aria-label={t('area.title')}
          autoFocus={area.title === ''}
          onCommit={(title) => engine.mutate('area', area.id, { title })}
        />
      </header>
      <QuickAdd onAdd={add} focusSignal={focusSignal} />
      <TagFilter present={present} active={tagFilter} onChange={setTagFilter} />
      {open.length === 0 && projects.length === 0 && <p className="empty">{t('area.empty')}</p>}
      <TaskGroup
        group={{ key: `area:${area.id}`, target: { kind: 'area', areaId: area.id } }}
        tasks={filtered}
        rowProps={(task) => ({
          open: openId === task.id,
          showWhen: true,
          showCaption: false,
          onOpen: () => setOpenId(task.id),
          onClose: () => setOpenId(null),
          onToggle: () => toggle(task),
        })}
      />
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
      <div className="page-actions">
        <button type="button" className="link" onClick={addProject}>
          + {t('nav.newProject')}
        </button>
        <button type="button" className="link danger" onClick={remove}>
          {t('area.delete')}
        </button>
      </div>
    </section>
  )
}
