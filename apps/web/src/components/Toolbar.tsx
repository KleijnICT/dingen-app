import type { Task } from '@dingen/core'
import {
  CalendarClock,
  CirclePlus,
  FolderInput,
  type LucideIcon,
  Tag as TagIcon,
  TextSearch,
  Trash2,
  UserRoundPlus,
} from 'lucide-react'
import { createContext, type ReactNode, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAgents } from '../agents.js'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { commitTask, whenFields } from '../taskActions.js'
import { AssigneeList } from './Assignee.js'
import { useDismiss } from './Menu.js'
import { MoveList } from './MoveList.js'
import { ScheduleField } from './ScheduleField.js'
import { BulkTags, DeleteQuestion } from './SelectionTools.js'
import type { TaskList } from './useTaskList.js'
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
      <Icon size={18} aria-hidden="true" />
    </button>
  )
}

interface TaskToolbarProps {
  /** Adds a task; left out where a list cannot take new tasks. */
  onNew?: (() => void) | undefined
  /** Buttons between New and When (New heading, New project). */
  extra?: ReactNode
  /** The page's task list, whose selection the buttons act on; left out where there is none. */
  list?: TaskList
}

type Popup = 'when' | 'move' | 'tags' | 'assign'

/**
 * The bar under a list of tasks: new, plan, move, tag and search. With several tasks
 * selected, When, Move and Tags act on all the open ones among them, the bar says how many
 * are selected and a Delete button joins in (Backspace does the same).
 */
export function TaskToolbar({ onNew, extra, list }: TaskToolbarProps) {
  const t = useT()
  const { openSearch } = useContext(ShellActions)
  const [chosen, setPopup] = useState<Popup | null>(null)
  // Assigning only shows once there is an agent to assign to.
  const hasAgents = useAgents().length > 0
  const root = useRef<HTMLDivElement>(null)
  const selection = list?.selection ?? []
  const many = selection.length > 1
  const selecting = list?.selecting ?? false
  const asking = list?.askingDelete ?? false
  const cancelDelete = list?.cancelDelete
  useDismiss(
    chosen !== null || asking,
    () => {
      setPopup(null)
      cancelDelete?.()
    },
    root,
  )
  // The open tasks among the selection; When, Move, Tags and Assign act on these.
  const targets = selection.filter((task) => task.status === 'open')
  const first = targets[0]
  const popup = asking || !first || (chosen === 'assign' && many) ? null : chosen
  const toggle = (p: Popup) => setPopup((c) => (c === p ? null : p))
  const compact = many || selecting

  return (
    <PageToolbar>
      <div className="toolbar-inner" ref={root}>
        {selecting && list && <SelectionBar count={selection.length} list={list} />}
        {onNew && !compact && (
          <ToolbarButton icon={CirclePlus} label={t('toolbar.newTask')} onClick={onNew} />
        )}
        {!compact && extra}
        {many && !selecting && (
          <span className="selection-count" aria-live="polite">
            {t('selection.count', { n: selection.length })}
          </span>
        )}
        <ToolbarButton
          icon={CalendarClock}
          label={t('toolbar.when')}
          disabled={!first}
          expanded={popup === 'when'}
          onClick={() => toggle('when')}
        />
        <ToolbarButton
          icon={FolderInput}
          label={t('toolbar.move')}
          disabled={!first}
          expanded={popup === 'move'}
          onClick={() => toggle('move')}
        />
        <ToolbarButton
          icon={TagIcon}
          label={t('toolbar.tags')}
          disabled={!first}
          expanded={popup === 'tags'}
          onClick={() => toggle('tags')}
        />
        {hasAgents && (
          <ToolbarButton
            icon={UserRoundPlus}
            label={t('assign.toolbar')}
            disabled={!first || many}
            expanded={popup === 'assign'}
            onClick={() => toggle('assign')}
          />
        )}
        {compact && list && (
          <ToolbarButton
            icon={Trash2}
            label={t('selection.delete')}
            disabled={selection.length === 0}
            expanded={asking}
            onClick={() => {
              setPopup(null)
              if (asking) list.cancelDelete()
              else list.deleteSelection()
            }}
          />
        )}
        {!compact && (
          <ToolbarButton icon={TextSearch} label={t('toolbar.search')} onClick={openSearch} />
        )}
        {popup && first && (
          <div
            className="popover toolbar-popover"
            role="dialog"
            aria-label={popup === 'assign' ? t('assign.toolbar') : t(`toolbar.${popup}`)}
          >
            {popup === 'when' ? (
              <WhenPopup tasks={targets} onDone={() => setPopup(null)} />
            ) : popup === 'move' ? (
              <MoveList task={first} others={targets.slice(1)} onDone={() => setPopup(null)} />
            ) : popup === 'tags' ? (
              <BulkTags tasks={targets} />
            ) : (
              <AssigneeList task={first} onDone={() => setPopup(null)} />
            )}
          </div>
        )}
        {asking && list && (
          <DeleteQuestion
            count={selection.length}
            onCancel={list.cancelDelete}
            onDelete={() => list.deleteSelection(true)}
          />
        )}
      </div>
    </PageToolbar>
  )
}

/** On a touch screen in selection mode: how many are selected, with Cancel and Done. */
function SelectionBar({ count, list }: { count: number; list: TaskList }) {
  const t = useT()
  return (
    <div className="selection-bar" role="toolbar" aria-label={t('selection.label')}>
      <button type="button" onClick={list.clearSelection}>
        {t('confirm.cancel')}
      </button>
      <span aria-live="polite">{t('selection.count', { n: count })}</span>
      <button type="button" className="selection-done" onClick={list.clearSelection}>
        {t('selection.done')}
      </button>
    </div>
  )
}

/**
 * When for one or more tasks. With several, picking a date keeps each task's own daypart
 * and picking a daypart sets it for all. Time and reminder only for a single task.
 */
function WhenPopup({ tasks, onDone }: { tasks: Task[]; onDone: () => void }) {
  const engine = useEngine()
  const ws = useWorkspace()
  const task = tasks[0]
  if (!task) return null
  return (
    <>
      <WhenPicker
        when={task.when}
        daypart={task.daypart}
        today={ws.today}
        onChange={(when, daypart, close) => {
          // One snapshot for all of them; the sync engine pushes the changes together.
          for (const x of tasks) {
            const own = tasks.length > 1 && !close ? x.daypart : daypart
            commitTask(engine, ws, x, whenFields(when, own))
          }
          if (close) onDone()
        }}
      />
      {tasks.length === 1 && (
        <ScheduleField task={task} onChange={(fields) => commitTask(engine, ws, task, fields)} />
      )}
    </>
  )
}
