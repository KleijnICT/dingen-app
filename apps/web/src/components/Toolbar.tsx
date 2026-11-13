import type { Task } from '@dingen/core'
import {
  CalendarClock,
  CirclePlus,
  FolderInput,
  type LucideIcon,
  TextSearch,
  UserRoundPlus,
} from 'lucide-react'
import { createContext, type ReactNode, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAgents } from '../agents.js'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { commitTask } from '../taskActions.js'
import { AssigneeList } from './Assignee.js'
import { useDismiss } from './Menu.js'
import { MoveList } from './MoveList.js'
import { ScheduleField } from './ScheduleField.js'
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
  const [popup, setPopup] = useState<'when' | 'move' | 'assign' | null>(null)
  // Assigning only shows once there is an agent to assign to.
  const hasAgents = useAgents().length > 0
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
        {hasAgents && (
          <ToolbarButton
            icon={UserRoundPlus}
            label={t('assign.toolbar')}
            disabled={selected?.status !== 'open'}
            expanded={shown === 'assign'}
            onClick={() => setPopup((p) => (p === 'assign' ? null : 'assign'))}
          />
        )}
        <ToolbarButton icon={TextSearch} label={t('toolbar.search')} onClick={openSearch} />
        {shown && selected && (
          <div
            className="popover toolbar-popover"
            role="dialog"
            aria-label={shown === 'assign' ? t('assign.toolbar') : t(`toolbar.${shown}`)}
          >
            {shown === 'when' ? (
              <WhenPopup task={selected} onDone={() => setPopup(null)} />
            ) : shown === 'move' ? (
              <MoveList task={selected} onDone={() => setPopup(null)} />
            ) : (
              <AssigneeList task={selected} onDone={() => setPopup(null)} />
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
    <>
      <WhenPicker
        when={task.when}
        evening={task.evening}
        today={ws.today}
        onChange={(when, evening) => {
          commitTask(engine, ws, task, { when, evening })
          onDone()
        }}
      />
      <ScheduleField task={task} onChange={(fields) => commitTask(engine, ws, task, fields)} />
    </>
  )
}
