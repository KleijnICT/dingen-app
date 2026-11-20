import { type Area, newProject, orderBetween, type Task, views } from '@dingen/core'
import { FolderPlus, RefreshCw, Trash2, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useT } from '../i18n/index.js'
import { navigate, projectPath } from '../router.js'
import { completedSection, splitSomeday } from '../sections.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { createListTask, deleteArea, useLinger } from '../taskActions.js'
import { AreaAppearance } from './AreaAppearance.js'
import { CompletedSection } from './CompletedSection.js'
import { EmptyState } from './EmptyState.js'
import { InlineInput } from './InlineInput.js'
import { MemberAvatars, MembersPanel, useAccess } from './MembersPanel.js'
import { MoreMenu } from './Menu.js'
import { ActiveFilters, FilterButton, type PageFilters, PageHeader } from './PageHeader.js'
import { ProjectRow } from './ProjectRow.js'
import { ReviewEveryField } from './ReviewEveryField.js'
import { TaskGroup } from './TaskGroup.js'
import type { RowProps } from './TaskRow.js'
import { TaskToolbar, ToolbarButton } from './Toolbar.js'
import { useOnSignal, useTaskList } from './useTaskList.js'

interface Props {
  area: Area
  focusSignal: number
  /** More on the title row, before the filter: the Review's "Mark reviewed". */
  headerExtra?: ReactNode
  /** False in the Review: an area is reviewed for its own tasks; projects have their own review. */
  showProjects?: boolean
}

export function AreaPage({ area, focusSignal, headerExtra, showProjects = true }: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const access = useAccess('area', area.id)
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  const all = views.areaTasks(ws.tasks, area.id)
  const open = all.filter((task) => task.status === 'open')
  const { shown, toggle } = useLinger(open, ws, engine)
  const completed = completedSection(all, shown)
  const present = new Set(open.flatMap((task) => task.tagIds))
  const filters: PageFilters = { present, tag: tagFilter, onTag: setTagFilter }
  const filtered = tagFilter ? shown.filter((task) => task.tagIds.includes(tagFilter)) : shown
  const projects = showProjects ? views.projectsOf(ws.projects, area.id) : []
  // Someday tasks and projects leave their usual place for a section at the bottom.
  const tasks = splitSomeday(filtered)
  const projectGroups = splitSomeday(projects)

  const taskList = useTaskList([...shown, ...completed], toggle)

  // A new task goes into this area, after its last open task.
  function addNew() {
    taskList.openNew(createListTask(engine, { areaId: area.id }, all, tagFilter).id)
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
      <PageHeader
        title={
          <>
            <AreaAppearance area={area} />
            <InlineInput
              className="title-input"
              wrap
              value={area.title}
              placeholder={t('area.untitled')}
              aria-label={t('area.title')}
              autoFocus={area.title === ''}
              onCommit={(title) => engine.mutate('area', area.id, { title })}
            />
            <MemberAvatars entries={access.entries} />
          </>
        }
        actions={
          <>
            {headerExtra}
            <FilterButton {...filters} />
            <MoreMenu
              alignEnd
              label={t('menu.areaActions')}
              items={[
                { label: t('nav.newProject'), icon: FolderPlus, onSelect: addProject },
                {
                  label: t('review.every.menu'),
                  icon: RefreshCw,
                  onSelect: () => {},
                  panel: () => <ReviewEveryField kind="area" item={area} />,
                },
                {
                  label: t('members.title'),
                  icon: Users,
                  onSelect: () => {},
                  panel: () => <MembersPanel type="area" id={area.id} access={access} />,
                },
                {
                  label: t('area.delete'),
                  icon: Trash2,
                  danger: true,
                  confirm: t('area.deleteQuestion'),
                  onSelect: remove,
                },
              ]}
            />
          </>
        }
      >
        <ActiveFilters {...filters} />
      </PageHeader>
      {all.length === 0 && projects.length === 0 && (
        <EmptyState title={t('area.empty')} text={t('area.emptyHint')} />
      )}
      <TaskGroup
        group={{ key: `area:${area.id}`, target: { kind: 'area', areaId: area.id } }}
        tasks={tasks.regular}
        rowProps={rowProps}
      />
      {projectGroups.regular.length > 0 && (
        <div className="group">
          <h2 className="group-title">{t('list.projects')}</h2>
          <ul className="tasks">
            {projectGroups.regular.map((p) => (
              <ProjectRow key={p.id} project={p} showArea={false} />
            ))}
          </ul>
        </div>
      )}
      {(tasks.someday.length > 0 || projectGroups.someday.length > 0) && (
        <div className="group someday-group">
          <TaskGroup
            group={{
              key: `area:${area.id}:someday`,
              target: { kind: 'when', when: { kind: 'someday' } },
            }}
            tasks={tasks.someday}
            rowProps={rowProps}
            header={<h2 className="group-title">{t('list.someday')}</h2>}
          />
          {projectGroups.someday.length > 0 && (
            <ul className="tasks">
              {projectGroups.someday.map((p) => (
                <ProjectRow key={p.id} project={p} showArea={false} />
              ))}
            </ul>
          )}
        </div>
      )}
      <CompletedSection sectionKey={`area:${area.id}`} tasks={completed} rowProps={rowProps} />
      <TaskToolbar
        onNew={addNew}
        extra={<ToolbarButton icon={FolderPlus} label={t('nav.newProject')} onClick={addProject} />}
        list={taskList}
      />
      {taskList.panel}
    </section>
  )
}
