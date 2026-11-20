import { createContext, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n/index.js'

interface HeaderProps {
  /** The pane's name, small and strong; or, as children, a breadcrumb or a field. */
  title?: ReactNode
  /** A quiet count next to the title. */
  count?: number | null
  /** Icon buttons on the right. */
  actions?: ReactNode
  /** Replaces the title: a breadcrumb, a back button, a search field. */
  children?: ReactNode
  className?: string
  /** The title's element: h2 by default, h1 in a window of its own. */
  as?: 'h1' | 'h2'
}

/**
 * The head of every pane: one row of `--pane-head` with a title, an optional count and icon
 * buttons on the right, and a hairline under it. All panes share it, so their first lines
 * line up across the window.
 */
export function PaneHeader({
  title,
  count,
  actions,
  children,
  className = '',
  as: Title = 'h2',
}: HeaderProps) {
  return (
    <header className={`pane-head ${className}`}>
      {children ?? <Title className="pane-title">{title}</Title>}
      {count != null && count > 0 && <span className="pane-count">{count}</span>}
      <span className="pane-head-space" />
      {actions && <div className="pane-actions">{actions}</div>}
    </header>
  )
}

interface PaneProps {
  header: ReactNode
  children: ReactNode
  className?: string
  /** The element: a section by default, nav for a list that navigates. */
  as?: 'section' | 'nav' | 'aside'
  label?: string
}

/** A pane: its head, then the content with the pane's margins, scrolling on its own. */
export function Pane({ header, children, className = '', as: Tag = 'section', label }: PaneProps) {
  return (
    <Tag className={`pane ${className}`} aria-label={label}>
      {header}
      <div className="pane-body">{children}</div>
    </Tag>
  )
}

/**
 * The parts of the content pane's head on a desktop that a page fills: the breadcrumb on the
 * left, the list's actions (what the bottom toolbar holds on a phone) and the page's own
 * actions (filter, focus, `…`) on the right. All null on a phone, where there is no such head.
 */
export interface ContentHeadSlots {
  crumb: HTMLElement | null
  page: HTMLElement | null
}

export const ContentHead = createContext<ContentHeadSlots>({ crumb: null, page: null })

/** Renders into one part of the content pane's head; nothing when there is no head. */
export function HeadPortal({
  slot,
  children,
}: {
  slot: keyof ContentHeadSlots
  children: ReactNode
}) {
  const el = useContext(ContentHead)[slot]
  return el ? createPortal(children, el) : null
}

export interface CrumbStep {
  key: string
  icon?: ReactNode
  label: ReactNode
  /** Goes there; a step without one is only a label. */
  onClick?: () => void
}

interface CrumbProps {
  /** The steps before the page itself, outermost first. */
  steps: CrumbStep[]
  /** A chevron after the last step, pointing at the page itself ("Work ›"). */
  trailing?: boolean
}

/** A quiet breadcrumb: each step leads there, separated by a chevron. */
export function Crumb({ steps, trailing = true }: CrumbProps) {
  const t = useT()
  if (steps.length === 0) return null
  return (
    <nav className="crumb" aria-label={t('crumb.label')}>
      {steps.map((step, i) => (
        <span key={step.key} className="crumb-step">
          {i > 0 && (
            <span className="crumb-sep" aria-hidden="true">
              ›
            </span>
          )}
          {step.onClick ? (
            <button type="button" className="crumb-link" onClick={step.onClick}>
              {step.icon}
              <span className="crumb-label">{step.label}</span>
            </button>
          ) : (
            <span className="crumb-link">
              {step.icon}
              <span className="crumb-label">{step.label}</span>
            </span>
          )}
        </span>
      ))}
      {trailing && (
        <span className="crumb-sep" aria-hidden="true">
          ›
        </span>
      )}
    </nav>
  )
}
