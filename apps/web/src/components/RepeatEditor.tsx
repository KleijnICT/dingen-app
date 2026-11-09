import type { Repeat, Task } from '@dingen/core'
import { useState } from 'react'
import { formatDate, useT } from '../i18n/index.js'
import { describeRepeat } from '../lists.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { setRepeat, stopRepeat } from '../taskActions.js'
import { RepeatIcon } from './Icons.js'

interface Props {
  task: Task
}

const UNITS = ['day', 'week', 'month', 'year'] as const
/** Monday first, as the calendar on the wall. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

/** The repeat rule of a task: a summary chip, and a small form when opened. */
export function RepeatEditor({ task }: Props) {
  const engine = useEngine()
  const ws = useWorkspace()
  const t = useT()
  const template = task.templateId ? ws.templateById.get(task.templateId) : undefined
  const current = template?.repeat ?? null
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Repeat>(() => current ?? defaultRule(task, ws.today))

  function save() {
    setRepeat(engine, ws, task, draft)
    setOpen(false)
  }

  function stop() {
    stopRepeat(engine, ws, task)
    setOpen(false)
  }

  function toggleWeekday(day: number) {
    const has = draft.weekdays.includes(day)
    setDraft({
      ...draft,
      weekdays: has ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day],
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`chip small ${current ? 'active' : ''}`}
        onClick={() => {
          setDraft(current ?? defaultRule(task, ws.today))
          setOpen(true)
        }}
      >
        <RepeatIcon /> {current ? describeRepeat(current) : t('repeat.add')}
      </button>
    )
  }

  return (
    <fieldset className="repeat-editor" aria-label={t('repeat.label')}>
      <label className="repeat-line">
        {t('repeat.every')}
        <input
          type="number"
          min={1}
          max={999}
          className="repeat-number"
          value={draft.every}
          onChange={(e) => setDraft({ ...draft, every: Math.max(1, Number(e.target.value) || 1) })}
        />
        <select
          value={draft.unit}
          onChange={(e) => setDraft({ ...draft, unit: e.target.value as Repeat['unit'] })}
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`repeat.unit.${unit}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="repeat-line">
        {(['schedule', 'completion'] as const).map((basis) => (
          <button
            type="button"
            key={basis}
            className={`chip small ${draft.basis === basis ? 'active' : ''}`}
            onClick={() => setDraft({ ...draft, basis })}
          >
            {t(`repeat.basis.${basis}`)}
          </button>
        ))}
      </div>
      {draft.unit === 'week' && draft.basis === 'schedule' && (
        <div className="repeat-line weekdays">
          {WEEKDAYS.map((day) => (
            <button
              type="button"
              key={day}
              className={`chip small ${draft.weekdays.includes(day) ? 'active' : ''}`}
              onClick={() => toggleWeekday(day)}
            >
              {formatDate(new Date(2026, 10, 1 + day), { weekday: 'short' })}
            </button>
          ))}
        </div>
      )}
      <label className="repeat-line">
        {t('repeat.start')}
        <input
          type="date"
          className="chip date"
          value={draft.start}
          onChange={(e) => {
            if (e.target.value) setDraft({ ...draft, start: e.target.value })
          }}
        />
      </label>
      <label className="repeat-line">
        {t('repeat.until')}
        <input
          type="date"
          className="chip date"
          value={draft.until ?? ''}
          min={draft.start}
          onChange={(e) => setDraft({ ...draft, until: e.target.value || null })}
        />
        {!draft.until && <span className="muted">{t('repeat.noEnd')}</span>}
      </label>
      <label className="repeat-line">
        {t('repeat.deadlineDays')}
        <input
          type="number"
          min={0}
          max={3650}
          className="repeat-number"
          value={draft.deadlineDays ?? ''}
          placeholder="–"
          onChange={(e) =>
            setDraft({
              ...draft,
              deadlineDays: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
            })
          }
        />
      </label>
      <div className="repeat-line">
        <button type="button" className="link" onClick={save}>
          {t('repeat.save')}
        </button>
        {current && (
          <button type="button" className="link danger" onClick={stop}>
            {t('repeat.stop')}
          </button>
        )}
        <button type="button" className="link" onClick={() => setOpen(false)}>
          {t('confirm.cancel')}
        </button>
      </div>
    </fieldset>
  )
}

function defaultRule(task: Task, today: string): Repeat {
  return {
    unit: 'week',
    every: 1,
    basis: 'schedule',
    weekdays: [],
    start: task.when.kind === 'date' && task.when.date > today ? task.when.date : today,
    until: null,
    deadlineDays: null,
  }
}
