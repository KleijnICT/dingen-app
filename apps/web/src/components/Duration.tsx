import { DURATION_CHOICES, DURATION_FILTERS } from '@dingen/core'
import { Timer } from 'lucide-react'
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  type DurationFilterList,
  parseDuration,
  setDurationFilter,
  useDurationText,
} from '../duration.js'
import { useT } from '../i18n/index.js'
import { useDismiss } from './Menu.js'

interface FieldProps {
  duration: number | null
  onChange: (duration: number | null) => void
}

/**
 * The estimated duration of a task in the panel: the usual choices as chips,
 * a field for any other number of minutes (or `1u30`), and a cross to clear it.
 */
export function DurationField({ duration, onChange }: FieldProps) {
  const t = useT()
  const text = useDurationText()
  const custom = duration !== null && !DURATION_CHOICES.includes(duration)
  const shownCustom = custom && duration !== null ? text(duration) : ''
  const [draft, setDraft] = useState(shownCustom)
  // A change from elsewhere (a choice, another device) replaces what the field shows.
  useEffect(() => setDraft(shownCustom), [shownCustom])

  function commitDraft() {
    if (draft.trim() === '' || draft === shownCustom) {
      setDraft(shownCustom)
      return
    }
    const minutes = parseDuration(draft)
    if (minutes === null) {
      setDraft(shownCustom)
      return
    }
    // A typed 15 lights up its chip; any other value stays in the field.
    setDraft(DURATION_CHOICES.includes(minutes) ? '' : text(minutes))
    if (minutes !== duration) onChange(minutes)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      commitDraft()
    }
  }

  return (
    <span className="duration-field">
      <Timer size={13} className="meta-icon" aria-hidden="true" />
      {DURATION_CHOICES.map((minutes) => (
        <button
          type="button"
          key={minutes}
          className={`chip small ${duration === minutes ? 'active' : ''}`}
          aria-pressed={duration === minutes}
          onClick={() => onChange(duration === minutes ? null : minutes)}
        >
          {text(minutes)}
        </button>
      ))}
      <input
        type="text"
        inputMode="numeric"
        className={`chip small duration-input ${custom ? 'active' : ''}`}
        value={draft}
        placeholder={t('duration.custom')}
        aria-label={t('duration.customLabel')}
        title={t('duration.customLabel')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={onKeyDown}
      />
      {duration !== null && (
        <button
          type="button"
          className="task-delete visible"
          aria-label={t('duration.clear')}
          title={t('duration.clear')}
          onClick={() => onChange(null)}
        >
          ×
        </button>
      )}
    </span>
  )
}

/** The duration in a task row: small and grey on the right. */
export function DurationBadge({ minutes }: { minutes: number }) {
  const t = useT()
  const text = useDurationText()
  return (
    <span className="meta-duration" title={t('duration.label')}>
      {text(minutes)}
    </span>
  )
}

interface FilterProps {
  list: DurationFilterList
  /** The active maximum in minutes; null when the filter is off. */
  active: number | null
}

/**
 * The duration filter of Today and Anytime: a button that opens the steps
 * (at most 5 minutes up to at most an hour) and Off. Kept per device and list.
 */
export function DurationFilter({ list, active }: FilterProps) {
  const t = useT()
  const text = useDurationText()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [alignEnd, setAlignEnd] = useState(false)
  const close = useCallback(() => {
    setOpen(false)
    setAlignEnd(false)
  }, [])
  useDismiss(open, close, root, button)

  // On a narrow screen the menu opens towards the left when it would run off the right edge.
  useLayoutEffect(() => {
    const el = menu.current
    if (!open || !el || alignEnd) return
    if (el.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
      setAlignEnd(true)
    }
  }, [open, alignEnd])

  function choose(max: number | null) {
    setDurationFilter(list, max)
    close()
    button.current?.focus()
  }

  const label = active === null ? t('duration.filter') : t('duration.atMost', { d: text(active) })
  const options: (number | null)[] = [...DURATION_FILTERS, null]

  return (
    <div className="duration-filter" ref={root}>
      <button
        ref={button}
        type="button"
        className={`chip small duration-filter-button ${active !== null ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('duration.filterLabel', { value: label })}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Timer size={12} aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div
          ref={menu}
          className={`popover menu duration-menu ${alignEnd ? 'end' : ''}`}
          role="menu"
          aria-label={t('duration.filter')}
        >
          {options.map((max) => (
            <button
              type="button"
              key={max ?? 'off'}
              role="menuitemradio"
              aria-checked={active === max}
              className={`menu-item ${active === max ? 'checked' : ''}`}
              onClick={() => choose(max)}
            >
              {max === null ? t('duration.off') : t('duration.atMost', { d: text(max) })}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
