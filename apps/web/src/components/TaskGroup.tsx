import type { Task } from '@dingen/core'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
import type { DropData, TaskGroupInfo } from '../dnd.js'
import { type RowProps, TaskRow } from './TaskRow.js'

interface Props {
  group: TaskGroupInfo
  tasks: Task[]
  rowProps: (task: Task) => RowProps
  /** No dragging at all (Logbook). */
  frozen?: boolean
  className?: string
  /** Rendered above the rows, inside the drop zone (a heading, for instance). */
  header?: ReactNode
}

/** One sortable list of task rows; also a drop target when empty. */
export function TaskGroup({
  group,
  tasks,
  rowProps,
  frozen = false,
  className = '',
  header,
}: Props) {
  const data: DropData = { type: 'group', group, siblings: tasks }
  const { setNodeRef, isOver } = useDroppable({ id: `group:${group.key}`, data, disabled: frozen })
  const dragging = useDndContext().active !== null && !frozen
  return (
    <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`task-group ${dragging ? 'drop-zone' : ''} ${isOver ? 'drop-over' : ''}`}
      >
        {header}
        <ul className={`tasks ${className}`}>
          {tasks.map((task) => (
            <SortableTaskRow
              key={task.id}
              task={task}
              group={group}
              siblings={tasks}
              frozen={frozen}
              {...rowProps(task)}
            />
          ))}
        </ul>
      </div>
    </SortableContext>
  )
}

interface SortableProps extends RowProps {
  task: Task
  group: TaskGroupInfo
  siblings: Task[]
  frozen: boolean
}

function SortableTaskRow({ task, group, siblings, frozen, ...row }: SortableProps) {
  const data: DropData = { type: 'task', task, group, siblings }
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
    data,
    disabled: frozen || row.open,
  })
  return (
    <TaskRow
      task={task}
      {...row}
      drag={{
        ref: setNodeRef,
        listeners: listeners ?? {},
        style: { transform: CSS.Translate.toString(transform), transition },
        dragging: isDragging,
      }}
    />
  )
}
