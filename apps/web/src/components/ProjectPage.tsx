import { type Heading, newHeading, newTask, orderBetween, type Project, views } from '@dingen/core'
import { useState } from 'react'
import { useT } from '../i18n/index.js'
import { navigate } from '../router.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { toggleProject, useLinger } from '../taskActions.js'
import { ProgressCircle } from './Icons.js'
import { InlineInput } from './InlineInput.js'
import { QuickAdd } from './QuickAdd.js'
import { TagEditor } from './TagEditor.js'
import { TagFilter } from './TagFilter.js'
import { TaskRow } from './TaskRow.js'
import { WhenPicker } from './WhenPicker.js'

interface Props {
  project: Project
  focusSignal: number
}

export function ProjectPage({ project, focusSignal }: Props) {
  const engine = useEngine()
  const t = useT()
  const ws = useWorkspace()
  const [openId, setOpenId] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const done = project.status !== 'open'

  const all = views.projectTasks(ws.tasks, project.id)
  const open = all.filter((task) => task.status === 'open')
  const completed = all.filter((task) => task.status !== 'open')
  const { shown: shownOpen, toggle } = useLinger(open, ws.tasks, engine)
  const present = new Set(open.flatMap((task) => task.tagIds))
  const filtered = tagFilter
    ? shownOpen.filter((task) => task.tagIds.includes(tagFilter))
    : shownOpen
  const headings = views.headingsOf(ws.headings, project.id)
  const progress = views.progress(project.id, ws.tasks)

  function add(title: string) {
    const siblings = open.filter((task) => task.headingId === null)
    engine.create(
      'task',
      newTask({
        title,
        projectId: project.id,
        when: { kind: 'anytime' },
        tagIds: tagFilter ? [tagFilter] : [],
        order: orderBetween(siblings.at(-1)?.order ?? null, null),
      }),
    )
  }

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

  function remove() {
    engine.mutate('project', project.id, { deleted: true })
    navigate(project.areaId ? `/area/${project.areaId}` : '/anytime')
  }

  const rows = (tasks: typeof all) =>
    tasks.map((task) => (
      <TaskRow
        key={task.id}
        task={task}
        open={openId === task.id}
        showWhen={true}
        showCaption={false}
        onOpen={() => setOpenId(task.id)}
        onClose={() => setOpenId(null)}
        onToggle={() => toggle(task)}
      />
    ))

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
      </header>
      <InlineInput
        multiline
        className="editor-notes page-notes"
        value={project.notes}
        placeholder={t('project.notes')}
        aria-label={t('project.notes')}
        onCommit={(notes) => engine.mutate('project', project.id, { notes })}
      />
      <div className="page-plan">
        <WhenPicker
          forProject
          when={project.when}
          evening={false}
          today={ws.today}
          onChange={(when) => engine.mutate('project', project.id, { when })}
        />
        <TagEditor
          tagIds={project.tagIds}
          onChange={(tagIds) => engine.mutate('project', project.id, { tagIds })}
        />
      </div>
      {!done && <QuickAdd onAdd={add} focusSignal={focusSignal} />}
      <TagFilter present={present} active={tagFilter} onChange={setTagFilter} />
      {all.length === 0 && <p className="empty">{t('project.empty')}</p>}
      <ul className="tasks">{rows(filtered.filter((task) => task.headingId === null))}</ul>
      {headings.map((heading) => (
        <div key={heading.id} className="group heading-group">
          <HeadingRow heading={heading} onRemove={() => removeHeading(heading)} />
          <ul className="tasks">
            {rows(filtered.filter((task) => task.headingId === heading.id))}
          </ul>
        </div>
      ))}
      <div className="page-actions">
        {!done && (
          <button type="button" className="link" onClick={addHeading}>
            + {t('project.newHeading')}
          </button>
        )}
        {completed.length > 0 && (
          <button type="button" className="link" onClick={() => setShowCompleted((s) => !s)}>
            {showCompleted
              ? t('project.hideCompleted')
              : t('project.showCompleted', { n: completed.length })}
          </button>
        )}
        <button type="button" className="link danger" onClick={remove}>
          {t('project.delete')}
        </button>
      </div>
      {showCompleted && (
        <ul className="tasks completed">{rows(completed.sort(views.byCompletedDesc))}</ul>
      )}
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
      <button
        type="button"
        className="task-delete"
        aria-label={t('heading.delete')}
        title={t('heading.delete')}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  )
}
