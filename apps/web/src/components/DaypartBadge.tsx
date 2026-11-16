import type { Task } from '@dingen/core'
import { useT } from '../i18n/index.js'

/** The daypart of a dated task, small in its row ("afternoon"); nothing without one. */
export function DaypartBadge({ task }: { task: Pick<Task, 'when' | 'daypart'> }) {
  const t = useT()
  if (task.when.kind !== 'date' || task.daypart === null) return null
  return (
    <span className="meta-daypart" title={t('daypart.label')}>
      {t(`daypart.${task.daypart}`).toLocaleLowerCase()}
    </span>
  )
}
