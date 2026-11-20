import {
  type Heading,
  newHeading,
  orderBetween,
  type Project,
  type Task,
  views,
} from '@dingen/core'
import {
  CalendarClock,
  CircleCheck,
  Flag,
  FolderInput,
  Heading as HeadingIcon,
  RefreshCw,
  RotateCcw,
  Tag,
  Trash2,
  Users,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useT } from '../i18n/index.js'
import { describeWhen } from '../lists.js'
import { areaPath, navigate } from '../router.js'
import { projectSections } from '../sections.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { createListTask, deleteProject, toggleProject, useLinger } from '../taskActions.js'
import { AreaGlyph } from './AreaIcons.js'
import { CompletedSection } from './CompletedSection.js'
import { DeadlineBadge, DeadlineField } from './DeadlineField.js'
import { EmptyState } from './EmptyState.js'
import { ProgressCircle } from './Icons.js'
import { InlineInput } from './InlineInput.js'
import { MemberAvatars, MembersPanel, useAccess } from './MembersPanel.js'
import { type MenuItem, MoreMenu } from './Menu.js'
import { ActiveFilters, FilterButton, type PageFilters, PageHeader } from './PageHeader.js'
import { Crumb, HeadPortal } from './Pane.js'
import { ReviewEveryField } from './ReviewEveryField.js'
import { TagEditor } from './TagEditor.js'
import { TaskGroup } from './TaskGroup.js'
import type { RowProps } from './TaskRow.js'
import { TaskToolbar, ToolbarButton } from './Toolbar.js'
import { useOnSignal, useTaskList } from './useTaskList.js'
import { WhenPicker } from './WhenPicker.js'

interface Props {
  project: Project
  focusSignal: number
  /** More on the title row, before the filter: the Review's "Mark reviewed". */
  headerExtra?: ReactNode
}

export function ProjectPage({ project, focusSignal, headerExtra }: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const access = useAccess('project', project.id)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const done = project.status !== 'open'

  const all = views.projectTasks(ws.tasks, project.id)
  const open = all.filter((task) => task.status === 'open')
  const { shown: shownOpen, toggle } = useLinger(open, ws, engine)
  const present = new Set(open.flatMap((task) => task.tagIds))
  const filters: PageFilters = { present, tag: tagFilter, onTag: setTagFilter }
  const headings = views.headingsOf(ws.headings, project.id)
  // Open tasks per heading, Someday ones below them; completed ones in their own section at the bottom.
  const sections = projectSections(all, shownOpen, headings, (task) =>
    tagFilter ? task.tagIds.includes(tagFilter) : true,
  )
  const progress = views.progress(project.id, ws.tasks)
  const area = project.areaId ? ws.areaById.get(project.areaId) : undefined

  const taskList = useTaskList([...shownOpen, ...sections.completed], toggle)

  // A new task goes into this project, after its last task without a heading.
  function addNew() {
    taskList.openNew(createListTask(engine, { projectId: project.id }, all, tagFilter).id)
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
  const group = (headingId: string | null, tasks: Task[], header?: ReactNode) => (
    <TaskGroup
      group={{
        key: `project:${project.id}:${headingId ?? 'root'}`,
        target: { kind: 'project', projectId: project.id, headingId },
      }}
      tasks={tasks}
      rowProps={rowProps}
      header={header}
    />
  )

  const menuItems: MenuItem[] = [
    {
      label: done ? t('project.reopen') : t('project.complete'),
      icon: done ? RotateCcw : CircleCheck,
      onSelect: () => toggleProject(engine, project),
    },
    {
      label: t('menu.when'),
      icon: CalendarClock,
      section: t('panel.planning'),
      onSelect: () => {},
      panel: (close) => (
        <WhenPicker
          forProject
          untitled
          when={project.when}
          daypart={null}
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
      icon: Flag,
      section: t('panel.planning'),
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
      label: t('review.every.menu'),
      icon: RefreshCw,
      section: t('panel.planning'),
      onSelect: () => {},
      panel: () => <ReviewEveryField kind="project" item={project} />,
    },
    {
      label: t('menu.tags'),
      icon: Tag,
      section: t('panel.organization'),
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
      icon: FolderInput,
      section: t('panel.organization'),
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
                <AreaGlyph icon={a.icon} color={a.color} size={16} />
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
      icon: Users,
      section: t('panel.organization'),
      onSelect: () => {},
      panel: () => <MembersPanel type="project" id={project.id} access={access} />,
    },
    {
      label: t('project.delete'),
      icon: Trash2,
      danger: true,
      confirm: t('project.deleteQuestion'),
      onSelect: remove,
    },
  ]

  return (
    <section className="list-page project">
      {area && !area.deleted && (
        <HeadPortal slot="crumb">
          <Crumb
            steps={[
              {
                key: area.id,
                icon: <AreaGlyph icon={area.icon} color={area.color} size={14} />,
                label: area.title || t('area.untitled'),
                onClick: () => navigate(areaPath(area.id)),
              },
            ]}
          />
        </HeadPortal>
      )}
      <PageHeader
        title={
          <>
            <button
              type="button"
              className={`project-check ${done ? 'done' : ''}`}
              aria-label={done ? t('project.reopen') : t('project.complete')}
              title={`${Math.round(progress * 100)}%`}
              onClick={() => toggleProject(engine, project)}
            >
              <ProgressCircle
                value={progress}
                done={done}
                someday={views.isSomeday(project)}
                size={26}
              />
            </button>
            <InlineInput
              className="title-input"
              wrap
              value={project.title}
              placeholder={t('project.outcomePlaceholder')}
              aria-label={t('project.title')}
              autoFocus={project.title === ''}
              onCommit={(title) => engine.mutate('project', project.id, { title })}
            />
            <MemberAvatars entries={access.entries} />
          </>
        }
        actions={
          <>
            {headerExtra}
            <FilterButton {...filters} />
            <MoreMenu alignEnd label={t('menu.projectActions')} items={menuItems} />
          </>
        }
      >
        <ActiveFilters {...filters} />
      </PageHeader>
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
      {all.length === 0 && <EmptyState title={t('project.empty')} text={t('project.emptyHint')} />}
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
      {sections.someday.length > 0 && (
        <div className="group someday-group">
          <TaskGroup
            group={{
              key: `project:${project.id}:someday`,
              target: { kind: 'when', when: { kind: 'someday' } },
            }}
            tasks={sections.someday}
            rowProps={rowProps}
            header={<h2 className="group-title">{t('list.someday')}</h2>}
          />
        </div>
      )}
      <CompletedSection
        sectionKey={`project:${project.id}`}
        tasks={sections.completed}
        rowProps={(task) => {
          // A calm reminder of where the task stood before it was completed.
          const heading = task.headingId ? ws.headingById.get(task.headingId) : undefined
          return heading && !heading.deleted && heading.title
            ? { ...rowProps(task), caption: heading.title }
            : rowProps(task)
        }}
      />
      <TaskToolbar
        onNew={addNew}
        extra={
          !done && (
            <ToolbarButton
              icon={HeadingIcon}
              label={t('project.newHeading')}
              onClick={addHeading}
            />
          )
        }
        list={taskList}
      />
      {taskList.panel}
    </section>
  )
}

interface HeadingProps {
  heading: Heading
  onRemove: () => void
}

export function HeadingRow({ heading, onRemove }: HeadingProps) {
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
        items={[{ label: t('heading.delete'), icon: Trash2, danger: true, onSelect: onRemove }]}
      />
    </div>
  )
}
