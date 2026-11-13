import { type Heading, newHeading, newTask, orderBetween, type Project, views } from '@dingen/core'
import { Heading as HeadingIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useT } from '../i18n/index.js'
import { completedDate, describeWhen } from '../lists.js'
import { navigate } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { deleteProject, toggleProject, useLinger } from '../taskActions.js'
import { AreaGlyph } from './AreaIcons.js'
import { DeadlineBadge, DeadlineField } from './DeadlineField.js'
import { ProgressCircle } from './Icons.js'
import { InlineInput } from './InlineInput.js'
import { MemberAvatars, MembersPanel, useAccess } from './MembersPanel.js'
import { MoreMenu } from './Menu.js'
import { TagEditor } from './TagEditor.js'
import { TagFilter } from './TagFilter.js'
import { TaskGroup } from './TaskGroup.js'
import type { RowProps } from './TaskRow.js'
import { TaskToolbar, ToolbarButton } from './Toolbar.js'
import { useOnSignal, useTaskList } from './useTaskList.js'
import { WhenPicker } from './WhenPicker.js'

interface Props {
  project: Project
  focusSignal: number
}

export function ProjectPage({ project, focusSignal }: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const access = useAccess('project', project.id)
  const [showCompleted, setShowCompleted] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const done = project.status !== 'open'

  const all = views.projectTasks(ws.tasks, project.id)
  const open = all.filter((task) => task.status === 'open')
  const completed = all.filter((task) => task.status !== 'open')
  const { shown: shownOpen, toggle } = useLinger(open, ws, engine)
  // Completed today stays at the bottom of the project until the day changes.
  const lingering = new Set(shownOpen.map((task) => task.id))
  const completedToday = completed
    .filter((task) => completedDate(task) === ws.today && !lingering.has(task.id))
    .sort(views.byCompletedDesc)
  const completedEarlier = completed
    .filter((task) => completedDate(task) !== ws.today)
    .sort(views.byCompletedDesc)
  const completedShown = showCompleted ? [...completedToday, ...completedEarlier] : completedToday
  const present = new Set(open.flatMap((task) => task.tagIds))
  const filtered = tagFilter
    ? shownOpen.filter((task) => task.tagIds.includes(tagFilter))
    : shownOpen
  const headings = views.headingsOf(ws.headings, project.id)
  const progress = views.progress(project.id, ws.tasks)

  const taskList = useTaskList([...shownOpen, ...completedShown], toggle)

  function addNew() {
    if (done) return
    const siblings = open.filter((task) => task.headingId === null)
    const task = newTask({
      title: '',
      projectId: project.id,
      when: { kind: 'anytime' },
      tagIds: tagFilter ? [tagFilter] : [],
      order: orderBetween(siblings.at(-1)?.order ?? null, null),
    })
    engine.create('task', task)
    taskList.openNew(task.id)
  }
  useOnSignal(focusSignal, addNew)

  function addHeading() {
    const heading = newHeading({
      title: '',
      projectId: project.id,
      order: orderBetween(headings.at(-1)?.order ?? null, null),
    })
    engine.create('heading', heading)
  }

  function removeHeading(heading: Heading) {
    for (const task of all) {
      if (task.headingId === heading.id) engine.mutate('task', task.id, { headingId: null })
    }
    engine.mutate('heading', heading.id, { deleted: true })
  }

  function moveToArea(areaId: string | null) {
    if (areaId === project.areaId) return
    const last = views.projectsOf(ws.projects, areaId).at(-1)
    engine.mutate('project', project.id, {
      areaId,
      order: orderBetween(last?.order ?? null, null),
    })
  }

  function remove() {
    deleteProject(engine, ws, project)
    navigate(project.areaId ? `/area/${project.areaId}` : '/anytime')
  }

  const rowProps = (task: (typeof all)[number]): RowProps =>
    taskList.rowProps(task, { showWhen: true })
  const group = (headingId: string | null, header?: ReactNode) => (
    <TaskGroup
      group={{
        key: `project:${project.id}:${headingId ?? 'root'}`,
        target: { kind: 'project', projectId: project.id, headingId },
      }}
      tasks={filtered.filter((task) => task.headingId === headingId)}
      rowProps={rowProps}
      header={header}
    />
  )

  return (
    <section className="list-page project">
      <header className="list-header project-header">
        <button
          type="button"
          className={`project-check ${done ? 'done' : ''}`}
          aria-label={done ? t('project.reopen') : t('project.complete')}
          title={`${Math.round(progress * 100)}%`}
          onClick={() => toggleProject(engine, project)}
        >
          <ProgressCircle value={progress} done={done} size={26} />
        </button>
        <InlineInput
          className="title-input"
          value={project.title}
          placeholder={t('project.untitled')}
          aria-label={t('project.title')}
          autoFocus={project.title === ''}
          onCommit={(title) => engine.mutate('project', project.id, { title })}
        />
        <MemberAvatars entries={access.entries} />
        <MoreMenu
          label={t('menu.projectActions')}
          items={[
            {
              label: done ? t('project.reopen') : t('project.complete'),
              onSelect: () => toggleProject(engine, project),
            },
            {
              label: t('menu.when'),
              onSelect: () => {},
              panel: (close) => (
                <WhenPicker
                  forProject
                  when={project.when}
                  evening={false}
                  today={ws.today}
                  onChange={(when) => {
                    engine.mutate('project', project.id, { when })
                    close()
                  }}
                />
              ),
            },
            {
              label: t('menu.deadline'),
              onSelect: () => {},
              panel: () => (
                <DeadlineField
                  deadline={project.deadline}
                  today={ws.today}
                  onChange={(deadline) => engine.mutate('project', project.id, { deadline })}
                />
              ),
            },
            {
              label: t('menu.tags'),
              onSelect: () => {},
              panel: () => (
                <TagEditor
                  tagIds={project.tagIds}
                  onChange={(tagIds) => engine.mutate('project', project.id, { tagIds })}
                />
              ),
            },
            {
              label: t('menu.move'),
              onSelect: () => {},
              panel: (close) => (
                <div className="move-list">
                  {[null, ...views.openAreas(ws.areas)].map((a) => (
                    <button
                      key={a?.id ?? 'none'}
                      type="button"
                      className="move-item"
                      aria-pressed={project.areaId === (a?.id ?? null)}
                      onClick={() => {
                        moveToArea(a?.id ?? null)
                        close()
                      }}
                    >
                      {a ? (
                        <AreaGlyph icon={a.icon} color={a.color} size={15} />
                      ) : (
                        <span className="move-none" />
                      )}
                      <span>{a ? a.title || t('area.untitled') : t('project.noArea')}</span>
                    </button>
                  ))}
                </div>
              ),
            },
            {
              label: t('members.title'),
              onSelect: () => {},
              panel: () => <MembersPanel type="project" id={project.id} access={access} />,
            },
            {
              label: t('project.delete'),
              danger: true,
              confirm: t('project.deleteQuestion'),
              onSelect: remove,
            },
          ]}
        />
      </header>
      <InlineInput
        multiline
        className="editor-notes page-notes"
        value={project.notes}
        placeholder={t('project.notes')}
        aria-label={t('project.notes')}
        onCommit={(notes) => engine.mutate('project', project.id, { notes })}
      />
      {(project.when.kind !== 'anytime' || project.deadline || project.tagIds.length > 0) && (
        <div className="page-meta">
          {project.when.kind !== 'anytime' && (
            <span className="when-chip">{describeWhen(project.when, ws.today)}</span>
          )}
          {project.deadline && <DeadlineBadge deadline={project.deadline} today={ws.today} />}
          {project.tagIds.map((id) => {
            const tag = ws.tagById.get(id)
            return tag ? (
              <span key={id} className="tag-chip small">
                {tag.title}
              </span>
            ) : null
          })}
        </div>
      )}
      <TagFilter present={present} active={tagFilter} onChange={setTagFilter} />
      {all.length === 0 && <p className="empty">{t('project.empty')}</p>}
      {group(null)}
      {headings.map((heading) => (
        <div key={heading.id} className="group heading-group">
          {group(
            heading.id,
            <HeadingRow heading={heading} onRemove={() => removeHeading(heading)} />,
          )}
        </div>
      ))}
      {completedShown.length > 0 && (
        <TaskGroup
          className="completed"
          group={{ key: `project:${project.id}:completed`, target: null }}
          tasks={completedShown}
          rowProps={rowProps}
          frozen
        />
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
        onNew={done ? undefined : addNew}
        extra={
          !done && (
            <ToolbarButton
              icon={HeadingIcon}
              label={t('project.newHeading')}
              onClick={addHeading}
            />
          )
        }
        selected={taskList.selected}
      />
      {taskList.panel}
    </section>
  )
}

interface HeadingProps {
  heading: Heading
  onRemove: () => void
}

function HeadingRow({ heading, onRemove }: HeadingProps) {
  const engine = useEngine()
  const t = useT()
  return (
    <div className="heading-row">
      <InlineInput
        className="heading-input"
        value={heading.title}
        placeholder={t('project.newHeading')}
        aria-label={t('heading.title')}
        autoFocus={heading.title === ''}
        onCommit={(title) => engine.mutate('heading', heading.id, { title })}
      />
      <MoreMenu
        alignEnd
        label={t('menu.headingActions')}
        items={[{ label: t('heading.delete'), danger: true, onSelect: onRemove }]}
      />
    </div>
  )
}
