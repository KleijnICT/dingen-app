import { type Task, views } from '@dingen/core'
import { CornerDownRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { type MoveTarget, moveTask } from '../taskActions.js'
import { AreaGlyph } from './AreaIcons.js'
import { ProgressCircle } from './Icons.js'

interface Props {
  task: Task
  onDone: () => void
  /**
   * Also list the headings of the task's project. Choosing a project that has headings then
   * keeps the list open, so a heading can follow.
   */
  withHeadings?: boolean
}

/** Every place a task can go: nowhere, a loose project, an area and its projects. */
export function MoveList({ task, onDone, withHeadings = false }: Props) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
  const current = task.projectId
    ? `project:${task.projectId}`
    : task.areaId
      ? `area:${task.areaId}`
      : 'none'
  const headings =
    withHeadings && task.projectId ? views.headingsOf(ws.headings, task.projectId) : []

  function move(target: MoveTarget) {
    moveTask(engine, ws, task, target)
    const stay =
      withHeadings &&
      target.kind === 'project' &&
      target.headingId === undefined &&
      target.projectId !== task.projectId &&
      views.headingsOf(ws.headings, target.projectId).length > 0
    if (!stay) onDone()
  }
  const item = (
    key: string,
    label: string,
    icon: ReactNode,
    target: MoveTarget,
    depth = 0,
    pressed = current === key,
  ) => (
    <button
      key={key}
      type="button"
      className="move-item"
      style={depth > 0 ? { paddingLeft: 8 + depth * 22 } : undefined}
      aria-pressed={pressed}
      onClick={() => move(target)}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
  const project = (id: string, title: string, depth = 0) => {
    const own = id === task.projectId
    return [
      item(
        `project:${id}`,
        title || t('project.untitled'),
        <ProgressCircle value={views.progress(id, ws.tasks)} size={15} />,
        { kind: 'project', projectId: id },
        depth,
        own && (headings.length === 0 || task.headingId === null),
      ),
      ...(own
        ? headings.map((h) =>
            item(
              `heading:${h.id}`,
              h.title || t('project.newHeading'),
              <CornerDownRight size={14} className="move-heading-icon" aria-hidden="true" />,
              { kind: 'project', projectId: id, headingId: h.id },
              depth + 1,
              task.headingId === h.id,
            ),
          )
        : []),
    ]
  }

  return (
    <div className="move-list">
      {item('none', t('task.noContainer'), <span className="move-none" />, { kind: 'none' })}
      {views.projectsOf(ws.projects, null).map((p) => project(p.id, p.title))}
      {views
        .openAreas(ws.areas)
        .map((a) => [
          item(
            `area:${a.id}`,
            a.title || t('area.untitled'),
            <AreaGlyph icon={a.icon} color={a.color} size={15} />,
            { kind: 'area', areaId: a.id },
          ),
          ...views.projectsOf(ws.projects, a.id).flatMap((p) => project(p.id, p.title, 1)),
        ])}
    </div>
  )
}
