import { AREA_COLORS, type AreaColorId } from '@dingen/core'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ApiError, api, errorText } from '../api.js'
import { refreshCalendar } from '../calendar.js'
import { type MessageKey, useT } from '../i18n/index.js'
import { areaColorVar, knownColor } from './AreaIcons.js'

interface CalendarSummary {
  id: string
  name: string
  color: string | null
  host: string
  createdAt: string
}

const FEED_ERRORS = new Set(['invalid_url', 'feed_unreachable', 'feed_invalid', 'feed_too_large'])

/** Kleuren die een nieuwe agenda om de beurt krijgt; grijs alleen als alles op is. */
const NEW_COLORS: AreaColorId[] = ['blue', 'green', 'orange', 'purple', 'red', 'mint', 'pink']

export function nextColor(used: (string | null)[]): AreaColorId {
  return NEW_COLORS.find((c) => !used.includes(c)) ?? 'gray'
}

/**
 * Tabblad "Agenda's": abonnementen op ICS-feeds toevoegen, hernoemen, een
 * kleur geven en verwijderen. De URL gaat één keer naar de server en komt
 * daarna nooit meer terug; alleen de host is zichtbaar.
 */
export function CalendarSettings() {
  const t = useT()
  const [calendars, setCalendars] = useState<CalendarSummary[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const describe = useCallback(
    (err: unknown) =>
      err instanceof ApiError && FEED_ERRORS.has(err.code)
        ? t(`calendar.error.${err.code}` as MessageKey)
        : errorText(err),
    [t],
  )

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ calendars: CalendarSummary[] }>('/api/calendars')
      setCalendars(res.calendars)
    } catch (err) {
      setError(describe(err))
    }
  }, [describe])

  useEffect(() => {
    void load()
  }, [load])

  async function changed() {
    await load()
    void refreshCalendar()
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.post('/api/calendars', {
        name: name.trim(),
        url: url.trim(),
        color: nextColor(calendars.map((c) => c.color)),
      })
      setName('')
      setUrl('')
      await changed()
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy(false)
    }
  }

  async function update(id: string, patch: { name?: string; color?: string | null }) {
    setError(null)
    try {
      await api.patch(`/api/calendars/${id}`, patch)
      await changed()
    } catch (err) {
      setError(describe(err))
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await api.delete(`/api/calendars/${id}`)
      await changed()
    } catch (err) {
      setError(describe(err))
    }
  }

  return (
    <div className="settings-form">
      <p className="muted">{t('calendar.intro')}</p>
      <ul className="calendar-list">
        {calendars.length === 0 && <li className="muted">{t('calendar.none')}</li>}
        {calendars.map((cal) => (
          <CalendarItem
            key={cal.id}
            calendar={cal}
            onRename={(next) => update(cal.id, { name: next })}
            onColor={(color) => update(cal.id, { color })}
            onRemove={() => remove(cal.id)}
          />
        ))}
      </ul>
      <form className="calendar-add" onSubmit={add}>
        <input
          type="text"
          placeholder={t('calendar.namePlaceholder')}
          aria-label={t('calendar.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
        />
        <input
          type="url"
          inputMode="url"
          placeholder={t('calendar.urlPlaceholder')}
          aria-label={t('calendar.urlPlaceholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          pattern="(https?|webcals?)://.+"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={busy}>
          {busy ? t('calendar.checking') : t('calendar.add')}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted calendar-help">{t('calendar.help')}</p>
    </div>
  )
}

function CalendarItem({
  calendar,
  onRename,
  onColor,
  onRemove,
}: {
  calendar: CalendarSummary
  onRename: (name: string) => void
  onColor: (color: string | null) => void
  onRemove: () => void
}) {
  const t = useT()
  const [name, setName] = useState(calendar.name)
  useEffect(() => setName(calendar.name), [calendar.name])
  const color = knownColor(calendar.color) ?? 'gray'

  function commit() {
    const next = name.trim()
    if (next && next !== calendar.name) onRename(next)
    else setName(calendar.name)
  }

  return (
    <li className="calendar-item">
      <div className="row">
        <span
          className="calendar-dot"
          style={{ background: areaColorVar(calendar.color) }}
          aria-hidden="true"
        />
        <input
          type="text"
          className="calendar-name"
          aria-label={t('calendar.rename')}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setName(calendar.name)
            }
          }}
        />
        <span className="calendar-host muted">{calendar.host}</span>
        <button type="button" className="link danger" onClick={onRemove}>
          {t('calendar.remove')}
        </button>
      </div>
      <div className="color-row calendar-colors">
        {AREA_COLORS.map((id) => (
          <button
            key={id}
            type="button"
            className="swatch"
            style={{ background: areaColorVar(id) }}
            aria-label={t(`areaColor.${id}` as MessageKey)}
            title={t(`areaColor.${id}` as MessageKey)}
            aria-pressed={color === id}
            onClick={() => onColor(id === 'gray' ? null : id)}
          />
        ))}
      </div>
    </li>
  )
}
