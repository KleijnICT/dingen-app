import type { Task } from '@dingen/core'
import { useT } from '../i18n/index.js'
import { toggleCompletedOpen, useCompletedOpen } from '../prefs.js'
import { ChevronIcon } from './Icons.js'
import { TaskGroup } from './TaskGroup.js'
import type { RowProps } from './TaskRow.js'

interface Props {
  /** `project:<id>` or `area:<id>`; also where the folded state is kept. */
  sectionKey: string
  tasks: Task[]
  rowProps: (task: Task) => RowProps
}

/**
 * The completed tasks of a project or area, in a section of their own at
 * the bottom of the page. Folded shut by default; the state is kept per
 * project or area on this device. The rows cannot be dragged and nothing
 * can be dropped here.
 */
export function CompletedSection({ sectionKey, tasks, rowProps }: Props) {
  const t = useT()
  const open = useCompletedOpen(sectionKey)
  if (tasks.length === 0) return null
  const id = `completed-${sectionKey.replace(':', '-')}`
  return (
    <div className="completed-section">
      <button
        type="button"
        className={`completed-toggle ${open ? '' : 'closed'}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => toggleCompletedOpen(sectionKey)}
      >
        <ChevronIcon className="completed-chevron" />
        <span>{t('completed.title')}</span>
        <span className="completed-count">{tasks.length}</span>
      </button>
      {open && (
        <div id={id}>
          <TaskGroup
            className="completed"
            group={{ key: `${sectionKey}:completed`, target: null }}
            tasks={tasks}
            rowProps={rowProps}
            frozen
          />
        </div>
      )}
    </div>
  )
}
