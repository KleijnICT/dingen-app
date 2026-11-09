import type { Project } from '@dingen/core'
import { views } from '@dingen/core'
import { formatDate, useT } from '../i18n/index.js'
import { navigate, projectPath } from '../router.js'
import { useWorkspace } from '../store/context.js'
import { ProgressCircle } from './Icons.js'

interface Props {
  project: Project
  /** Show the area as caption. */
  showArea?: boolean
}

/** A project as a row in a list; clicking opens the project. */
export function ProjectRow({ project, showArea = true }: Props) {
  const t = useT()
  const ws = useWorkspace()
  const done = project.status !== 'open'
  const area = project.areaId ? ws.areaById.get(project.areaId) : null
  return (
    <li className={`task project-row ${done ? 'done' : ''}`}>
      <button type="button" className="task-main" onClick={() => navigate(projectPath(project.id))}>
        <ProgressCircle
          value={views.progress(project.id, ws.tasks)}
          done={done}
          className="row-progress"
        />
        <span className="task-text">
          <span className="task-title">{project.title || <em>{t('project.untitled')}</em>}</span>
          {showArea && area && <span className="task-caption">{area.title}</span>}
        </span>
        <span className="task-meta">
          {done && project.completedAt && (
            <span className="meta-when">
              {formatDate(new Date(project.completedAt), { dateStyle: 'medium' })}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
