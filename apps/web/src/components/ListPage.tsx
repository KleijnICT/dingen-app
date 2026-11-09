import { newTask, orderBetween, type Task } from '@dingen/core'
import { useEffect, useRef, useState } from 'react'
import { type MessageKey, useT } from '../i18n/index.js'
import { describeDate, describeLongDate, type ListDef, listTasks } from '../lists.js'
import { useEngine, useTasks } from '../store/context.js'
import { QuickAdd } from './QuickAdd.js'
import { TaskRow } from './TaskRow.js'

interface Props {
  list: ListDef
  today: string
  focusSignal: number
}

const LINGER_MS = 1200

export function ListPage({ list, today, focusSignal }: Props) {
  const engine = useEngine()
  const t = useT()
  const tasks = useTasks()
  const [openId, setOpenId] = useState<string | null>(null)
  // Net afgevinkte taken blijven even staan, zodat de handeling zichtbaar is.
  const [lingering, setLingering] = useState<Map<string, Task>>(new Map())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending.values()) clearTimeout(t)
    }
  }, [])

  const visible = listTasks(list.id, tasks, today)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const shown: Task[] = [...visible]
  for (const [id] of lingering) {
    const current = byId.get(id)
    if (current && !shown.some((t) => t.id === id)) shown.push(current)
  }
  if (lingering.size > 0) shown.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

  function toggle(task: Task) {
    const completing = task.status === 'open'
    engine.mutate('task', task.id, {
      status: completing ? 'completed' : 'open',
      completedAt: completing ? new Date().toISOString() : null,
    })
    setLingering((m) => new Map(m).set(task.id, task))
    const existing = timers.current.get(task.id)
    if (existing) clearTimeout(existing)
    timers.current.set(
      task.id,
      setTimeout(() => {
        timers.current.delete(task.id)
        setLingering((m) => {
          const next = new Map(m)
          next.delete(task.id)
          return next
        })
      }, LINGER_MS),
    )
  }

  function add(title: string) {
    const when = list.newWhen(today)
    if (!when) return
    const last = visible.at(-1)
    engine.create('task', newTask({ title, when, order: orderBetween(last?.order ?? null, null) }))
  }

  const groups = list.id === 'upcoming' ? groupByDate(shown) : null
  const evening = list.id === 'today' ? shown.filter((task) => task.evening) : []
  const day = list.id === 'today' ? shown.filter((task) => !task.evening) : shown

  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      today={today}
      open={openId === task.id}
      showWhen={list.id === 'logbook'}
      onOpen={() => setOpenId(task.id)}
      onClose={() => setOpenId(null)}
      onToggle={() => toggle(task)}
    />
  )

  return (
    <section className={`list-page ${list.id}`}>
      <header className="list-header">
        <h1>{t(list.titleKey)}</h1>
        {list.id === 'today' && <p className="muted">{describeLongDate(today)}</p>}
      </header>
      {list.newWhen(today) && <QuickAdd onAdd={add} focusSignal={focusSignal} />}
      {shown.length === 0 && <p className="empty">{t(`list.empty.${list.id}` as MessageKey)}</p>}
      {groups ? (
        groups.map((g) => (
          <div key={g.date} className="group">
            <h2 className="group-title">{describeDate(g.date, today)}</h2>
            <ul className="tasks">{g.tasks.map(row)}</ul>
          </div>
        ))
      ) : (
        <>
          <ul className="tasks">{day.map(row)}</ul>
          {evening.length > 0 && (
            <div className="group evening">
              <h2 className="group-title">{t('list.thisEvening')}</h2>
              <ul className="tasks">{evening.map(row)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function groupByDate(tasks: Task[]): { date: string; tasks: Task[] }[] {
  const groups = new Map<string, Task[]>()
  for (const t of tasks) {
    const date = t.when.kind === 'date' ? t.when.date : ''
    groups.set(date, [...(groups.get(date) ?? []), t])
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, tasks]) => ({ date, tasks }))
}
