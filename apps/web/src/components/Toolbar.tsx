import { type Task, views } from '@dingen/core'
import { CalendarClock, CirclePlus, FolderInput, type LucideIcon, TextSearch } from 'lucide-react'
import { createContext, type ReactNode, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { commitTask, type MoveTarget, moveTask } from '../taskActions.js'
import { AreaGlyph } from './AreaIcons.js'
import { ProgressCircle } from './Icons.js'
import { useDismiss } from './Menu.js'
import { WhenPicker } from './WhenPicker.js'

/** The element at the bottom of the content pane that pages fill with their buttons. */
export const ToolbarSlot = createContext<HTMLElement | null>(null)

/** Window-level actions a page can start. */
export const ShellActions = createContext<{ openSearch: () => void }>({ openSearch: () => {} })

/** Renders a page's buttons into the bar at the bottom of the content pane. */
export function PageToolbar({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlot)
  return slot ? createPortal(children, slot) : null
}

interface ButtonProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  expanded?: boolean
}

export function ToolbarButton({ icon: Icon, label, onClick, disabled, expanded }: ButtonProps) {
  return (
    <button
      type="button"
      className="toolbar-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
}

interface TaskToolbarProps {
  /** Adds a task; left out where a list cannot take new tasks. */
  onNew?: (() => void) | undefined
  /** Buttons between New and When (New heading, New project). */
  extra?: ReactNode
  selected: Task | undefined
}

/** The bar under a list of tasks: new, plan, move and search. */
export function TaskToolbar({ onNew, extra, selected }: TaskToolbarProps) {
  const t = useT()
  const { openSearch } = useContext(ShellActions)
  const [popup, setPopup] = useState<'when' | 'move' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(popup !== null, () => setPopup(null), root)
  const shown = selected?.status === 'open' ? popup : null

  return (
    <PageToolbar>
      <div className="toolbar-inner" ref={root}>
        {onNew && <ToolbarButton icon={CirclePlus} label={t('toolbar.newTask')} onClick={onNew} />}
        {extra}
        <ToolbarButton
          icon={CalendarClock}
          label={t('toolbar.when')}
          disabled={selected?.status !== 'open'}
          expanded={shown === 'when'}
          onClick={() => setPopup((p) => (p === 'when' ? null : 'when'))}
        />
        <ToolbarButton
          icon={FolderInput}
          label={t('toolbar.move')}
          disabled={selected?.status !== 'open'}
          expanded={shown === 'move'}
          onClick={() => setPopup((p) => (p === 'move' ? null : 'move'))}
        />
        <ToolbarButton icon={TextSearch} label={t('toolbar.search')} onClick={openSearch} />
        {shown && selected && (
          <div className="popover toolbar-popover" role="dialog" aria-label={t(`toolbar.${shown}`)}>
            {shown === 'when' ? (
              <WhenPopup task={selected} onDone={() => setPopup(null)} />
            ) : (
              <MovePopup task={selected} onDone={() => setPopup(null)} />
            )}
          </div>
        )}
      </div>
    </PageToolbar>
  )
}

function WhenPopup({ task, onDone }: { task: Task; onDone: () => void }) {
  const engine = useEngine()
  const ws = useWorkspace()
  return (
    <WhenPicker
      when={task.when}
      evening={task.evening}
      today={ws.today}
      onChange={(when, evening) => {
        commitTask(engine, ws, task, { when, evening })
        onDone()
      }}
    />
  )
}

function MovePopup({ task, onDone }: { task: Task; onDone: () => void }) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
  const current = task.projectId
    ? `project:${task.projectId}`
    : task.areaId
      ? `area:${task.areaId}`
      : 'none'

  function move(target: MoveTarget) {
    moveTask(engine, ws, task, target)
    onDone()
  }
  const item = (
    key: string,
    label: string,
    icon: ReactNode,
    target: MoveTarget,
    nested = false,
  ) => (
    <button
      key={key}
      type="button"
      className={`move-item ${nested ? 'nested' : ''}`}
      aria-pressed={current === key}
      onClick={() => move(target)}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
  const project = (id: string, title: string, nested = false) =>
    item(
      `project:${id}`,
      title || t('project.untitled'),
      <ProgressCircle value={views.progress(id, ws.tasks)} size={15} />,
      { kind: 'project', projectId: id },
      nested,
    )

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
          ...views.projectsOf(ws.projects, a.id).map((p) => project(p.id, p.title, true)),
        ])}
    </div>
  )
}
