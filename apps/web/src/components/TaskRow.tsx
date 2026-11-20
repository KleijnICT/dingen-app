import type { Tag, Task } from '@dingen/core'
import { views } from '@dingen/core'
import type { CSSProperties } from 'react'
import { formatDate, useT } from '../i18n/index.js'
import { containerOf, describeWhen } from '../lists.js'
import { useLongPress } from '../longPress.js'
import { useWorkspace } from '../store/context.js'
import type { ClickHow } from '../taskPanel.js'
import { AssigneeBadge } from './Assignee.js'
import { DaypartBadge } from './DaypartBadge.js'
import { DeadlineBadge } from './DeadlineField.js'
import { DurationBadge } from './Duration.js'
import { CheckIcon, ChecklistIcon, NotesIcon, RepeatIcon } from './Icons.js'
import { ScheduleBadge } from './ScheduleField.js'

export interface RowProps {
  /** Shown in the task panel. */
  open: boolean
  selected: boolean
  showWhen: boolean
  /** Show the daypart of a dated task (Upcoming); rows that show the date show it too. */
  showDaypart?: boolean
  /** Show the project or area under the title (off inside that project or area). */
  showCaption: boolean
  /** Came into Today by itself and not seen yet: a dot before the title. */
  isNew?: boolean
  /** Text under the title in place of the project or area (a heading name, for instance). */
  caption?: string
  /**
   * A click: selects the task (with a mouse) or opens it in the panel (on a touch screen,
   * or when the panel is already open, it then shows this task). With Shift it selects a
   * range, with Cmd or Ctrl it adds or removes this task.
   */
  onSelect: (how?: ClickHow) => void
  /** A long press on a touch screen: starts selecting several tasks. */
  onLongPress?: () => void
  /** Double click: opens the task in the panel. */
  onOpen: () => void
  /** The selection, when this task is part of a selection of several: a drag carries them all. */
  selection?: readonly Task[] | undefined
  onToggle: () => void
}

export interface DragHandle {
  ref: (el: HTMLElement | null) => void
  listeners: Record<string, unknown>
  style: CSSProperties
  dragging: boolean
}

interface Props extends RowProps {
  task: Task
  drag?: DragHandle
}

export function TaskRow({
  task,
  open,
  selected,
  showWhen,
  showDaypart = false,
  showCaption,
  isNew = false,
  caption,
  onSelect,
  onOpen,
  onToggle,
  onLongPress,
  drag,
}: Props) {
  const press = useLongPress(onLongPress)
  const ws = useWorkspace()
  const t = useT()
  const done = task.status !== 'open'

  const container = showCaption ? containerOf(task, ws) : null
  const heading = task.headingId ? ws.headingById.get(task.headingId) : null
  const tags = task.tagIds.map((id) => ws.tagById.get(id)).filter((x): x is Tag => Boolean(x))
  const checklist = views.checklistProgress(ws.checklistByTask.get(task.id) ?? [])

  return (
    <li
      ref={drag?.ref}
      style={drag?.style}
      data-task-id={task.id}
      className={`task ${done ? 'done' : ''} ${selected ? 'selected' : ''} ${open ? 'open' : ''} ${drag?.dragging ? 'dragging' : ''}`}
      {...drag?.listeners}
    >
      <button
        type="button"
        className={`check ${!done && task.when.kind === 'someday' ? 'someday' : ''}`}
        aria-label={done ? t('task.markOpen') : t('task.markDone')}
        aria-pressed={done}
        onClick={onToggle}
      >
        {done && <CheckIcon />}
      </button>
      <button
        type="button"
        className="task-main"
        aria-pressed={selected}
        aria-expanded={open}
        {...press.handlers}
        onMouseDown={(e) => {
          // Shift-click selects a range; it should not also select the text.
          if (e.shiftKey) e.preventDefault()
        }}
        onClick={(e) => {
          if (press.consumeClick()) return
          onSelect({ range: e.shiftKey, toggle: e.metaKey || e.ctrlKey })
        }}
        onDoubleClick={(e) => {
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) onOpen()
        }}
      >
        <span className="task-text">
          <span className="task-title">
            {isNew && <span className="task-new-dot" title={t('today.new.dot')} />}
            {task.title || <em>{t('task.untitled')}</em>}
          </span>
          {caption ? (
            <span className="task-caption">{caption}</span>
          ) : (
            container && (
              <span className="task-caption">
                {container.title}
                {heading && !showCaption ? ` › ${heading.title}` : ''}
              </span>
            )
          )}
        </span>
        <span className="task-meta">
          {tags.map((tag) => (
            <span key={tag.id} className="tag-chip small">
              {tag.title}
            </span>
          ))}
          {!done && <ScheduleBadge task={task} />}
          {task.notes && <NotesIcon className="meta-icon" />}
          {checklist.total > 0 && (
            <span className="meta-checklist">
              <ChecklistIcon className="meta-icon" />
              {checklist.done}/{checklist.total}
            </span>
          )}
          {task.templateId && <RepeatIcon className="meta-icon" />}
          {task.assigneeId && <AssigneeBadge assigneeId={task.assigneeId} />}
          {!done && task.deadline && <DeadlineBadge deadline={task.deadline} today={ws.today} />}
          {showWhen && task.when.kind === 'date' && (
            <span className="meta-when">{describeWhen(task.when, ws.today)}</span>
          )}
          {!done && (showWhen || showDaypart) && <DaypartBadge task={task} />}
          {!done && task.duration !== null && <DurationBadge minutes={task.duration} />}
          {done && task.completedAt && (
            <span className="meta-when">
              {formatDate(new Date(task.completedAt), { dateStyle: 'medium' })}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
