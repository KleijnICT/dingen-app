import type { Area } from '@dingen/core'
import { ListFilter, type LucideIcon, X } from 'lucide-react'
import { type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type DurationFilterList, setDurationFilter, useDurationText } from '../duration.js'
import { useT } from '../i18n/index.js'
import { useWorkspace } from '../store/context.js'
import { DurationFilter } from './Duration.js'
import { Sheet, SheetSection, useDismiss } from './Menu.js'
import { ContentHead } from './Pane.js'
import { TagFilter, useFilterTags } from './TagFilter.js'

interface Props {
  /** The title: an h1, or the inline title field of a project or area with what goes with it. */
  title: ReactNode
  /** One small muted line under the title (Today's date and total). */
  subtitle?: ReactNode
  /** Quiet icon buttons on the right of the title row: filter, focus, the `…` menu. */
  actions?: ReactNode
  /** What goes under the subtitle: the active filters, the Logbook's own filters. */
  children?: ReactNode
  className?: string
}

/**
 * The calm top of every list, project and area page: the title, one muted line under it, and
 * only the filters that are on. The page's quiet icon buttons sit in the content pane's head
 * on a desktop, and on the title row on a phone.
 */
export function PageHeader({ title, subtitle, actions, children, className = '' }: Props) {
  const headSlot = useContext(ContentHead).page
  const buttons = actions && <div className="page-header-actions">{actions}</div>
  return (
    <header className={`list-header page-header ${className}`}>
      <div className="page-header-row">
        <div className="page-header-title">{title}</div>
        {headSlot ? buttons && createPortal(buttons, headSlot) : buttons}
      </div>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
      {children}
    </header>
  )
}

interface ButtonProps {
  icon: LucideIcon
  label: string
  /** The tooltip, when it says more than the label. */
  hint?: string
  pressed?: boolean
  onClick: () => void
}

/** A quiet icon button on the title row. */
export function HeaderButton({ icon: Icon, label, hint, pressed, onClick }: ButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${pressed ? 'on' : ''}`}
      aria-label={label}
      title={hint ?? label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  )
}

/** The filters of a page: tags (all pages) and, on Today and Anytime, the duration. */
export interface PageFilters {
  /** Tag ids that occur on the page. */
  present: Set<string>
  tag: string | null
  onTag: (tagId: string | null) => void
  /** The list whose duration filter shows here; null when there is none to show. */
  durationList?: DurationFilterList | null
  maxDuration?: number | null
  /** The areas to filter on (Today); none hides the area filter. */
  areas?: Area[]
  area?: string | null
  onArea?: (areaId: string | null) => void
  /** More filters for the same popover (the Logbook's kinds, people and period). */
  extra?: ReactNode
  /** Whether one of those extra filters is on. */
  extraActive?: boolean
}

/**
 * The filter button: one popover with the tag filter and the duration filter. Only there
 * when there is something to filter.
 */
export function FilterButton({
  present,
  tag,
  onTag,
  durationList,
  maxDuration,
  areas = [],
  area = null,
  onArea,
  extra,
  extraActive = false,
}: PageFilters) {
  const t = useT()
  const tags = useFilterTags(present)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, root, button)

  const hasTags = tags.length > 0 || tag !== null
  const hasAreas = Boolean(onArea) && areas.length > 0
  if (!hasTags && !durationList && !hasAreas && !extra) return null
  const active =
    tag !== null || (maxDuration ?? null) !== null || (hasAreas && area !== null) || extraActive
  const label = t('filter.button')

  return (
    <div className="filter-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={`icon-button ${active ? 'on' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ListFilter size={16} aria-hidden="true" />
      </button>
      {open && (
        <Sheet label={label} align="end" className="filter-popover" onClose={close}>
          {extra && <SheetSection inset>{extra}</SheetSection>}
          {hasAreas && (
            <SheetSection inset title={t('area.filter')}>
              <fieldset className="filter-chips" aria-label={t('area.filter')}>
                <button
                  type="button"
                  className={`chip small ${area === null ? 'active' : ''}`}
                  aria-pressed={area === null}
                  onClick={() => onArea?.(null)}
                >
                  {t('tags.all')}
                </button>
                {areas.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className={`chip small ${area === a.id ? 'active' : ''}`}
                    aria-pressed={area === a.id}
                    onClick={() => onArea?.(area === a.id ? null : a.id)}
                  >
                    {a.title}
                  </button>
                ))}
              </fieldset>
            </SheetSection>
          )}
          {hasTags && (
            <SheetSection inset title={t('tags.label')}>
              <TagFilter present={present} active={tag} onChange={onTag} />
            </SheetSection>
          )}
          {durationList && (
            <SheetSection inset title={t('duration.filter')}>
              <DurationFilter list={durationList} active={maxDuration ?? null} />
            </SheetSection>
          )}
        </Sheet>
      )}
    </div>
  )
}

/** The filters that are on, as small chips under the subtitle; × turns one off. */
export function ActiveFilters({
  tag,
  onTag,
  durationList,
  maxDuration,
  area = null,
  onArea,
}: PageFilters) {
  const t = useT()
  const ws = useWorkspace()
  const text = useDurationText()
  const chips: { key: string; label: string; clear: () => void }[] = []
  if (area !== null && onArea) {
    chips.push({
      key: 'area',
      label: ws.areaById.get(area)?.title ?? '',
      clear: () => onArea(null),
    })
  }
  if (tag !== null) {
    chips.push({ key: 'tag', label: ws.tagById.get(tag)?.title ?? '', clear: () => onTag(null) })
  }
  if (durationList && maxDuration != null) {
    chips.push({
      key: 'duration',
      label: t('duration.atMost', { d: text(maxDuration) }),
      clear: () => setDurationFilter(durationList, null),
    })
  }
  return <FilterChips chips={chips} />
}

/**
 * A filter button whose popover holds any filters a page brings (the Logbook's kinds,
 * people and period). `active` colours the button when something is narrowed down.
 */
export function FilterPopover({ active, children }: { active: boolean; children: ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, root, button)
  const label = t('filter.button')
  return (
    <div className="filter-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={`icon-button ${active ? 'on' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ListFilter size={16} aria-hidden="true" />
      </button>
      {open && (
        <Sheet label={label} align="end" className="filter-popover" onClose={close}>
          <SheetSection inset>{children}</SheetSection>
        </Sheet>
      )}
    </div>
  )
}

/** Small chips for filters that are on; × turns one off. */
export function FilterChips({
  chips,
}: {
  chips: { key: string; label: string; clear: () => void }[]
}) {
  const t = useT()
  if (chips.length === 0) return null
  return (
    <div className="active-filters">
      {chips.map((chip) => (
        <span key={chip.key} className="active-filter">
          {chip.label}
          <button
            type="button"
            className="active-filter-clear"
            aria-label={t('filter.clear', { name: chip.label })}
            title={t('filter.clear', { name: chip.label })}
            onClick={chip.clear}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  )
}
