import { Check, ChevronLeft, EllipsisVertical } from 'lucide-react'
import {
  type ComponentType,
  type ReactNode,
  type Ref,
  type RefObject,
  type TouchEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useT } from '../i18n/index.js'

/** Closes a popover on a pointer down outside `root` or on Escape. */
export function useDismiss(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
  button?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (root.current && !root.current.contains(e.target as Node)) close()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
      button?.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close, root, button])
}

/** Phones get every sheet from the bottom of the screen (the one mobile block in styles.css). */
const PHONE = '(max-width: 720px)'
/** How far a sheet has to be pulled down before letting go closes it. */
const SWIPE_CLOSE = 80

interface SheetProps {
  /** The accessible name: what the sheet is for. */
  label: string
  role?: 'menu' | 'dialog'
  /** Which edge of its anchor it lines up with; `stretch` takes the anchor's width. */
  align?: 'start' | 'end' | 'center' | 'stretch'
  /** Opens under its anchor, or above it (anchors at the bottom of a pane). */
  side?: 'below' | 'above'
  /** Extra classes for the sheet's own content (width, a menu's column). */
  className?: string
  /** Closes the sheet: a tap on the scrim or a swipe down on a phone. */
  onClose: () => void
  sheetRef?: Ref<HTMLDivElement>
  children: ReactNode
}

/**
 * The one surface for menus and popovers: a small card next to the button that opened it,
 * and on a phone a sheet from the bottom with a grab handle over a scrim. It stays inside
 * its anchor in the DOM, so the anchor's click-outside and focus handling keep working;
 * Escape and clicks outside are the anchor's job (`useDismiss`).
 */
export function Sheet({
  label,
  role = 'dialog',
  align = 'start',
  side = 'below',
  className = '',
  onClose,
  sheetRef,
  children,
}: SheetProps) {
  const own = useRef<HTMLDivElement | null>(null)
  const swipe = useRef<{ y: number; dy: number } | null>(null)

  function setRef(el: HTMLDivElement | null) {
    own.current = el
    if (typeof sheetRef === 'function') sheetRef(el)
    else if (sheetRef) (sheetRef as { current: HTMLDivElement | null }).current = el
  }

  // Pulling a phone sheet down (from the top of its content) moves it along; far enough closes it.
  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0]
    const el = own.current
    swipe.current =
      touch && el && e.touches.length === 1 && el.scrollTop <= 0 && matchMedia(PHONE).matches
        ? { y: touch.clientY, dy: 0 }
        : null
  }
  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0]
    const el = own.current
    if (!swipe.current || !touch || !el) return
    const dy = Math.max(0, touch.clientY - swipe.current.y)
    swipe.current.dy = dy
    el.style.transition = 'none'
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
  }
  function onTouchEnd() {
    const el = own.current
    const pulled = swipe.current?.dy ?? 0
    swipe.current = null
    if (!el) return
    el.style.transition = ''
    el.style.transform = ''
    if (pulled > SWIPE_CLOSE) onClose()
  }

  return (
    <>
      <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is menu or dialog, both named */}
      <div
        ref={setRef}
        className={`sheet ${className}`}
        data-align={align}
        data-side={side}
        role={role}
        aria-label={label}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <span className="sheet-grab" aria-hidden="true" />
        {children}
      </div>
    </>
  )
}

interface SectionProps {
  title?: string | undefined
  /**
   * Insets the content to line up with the heading: for fields, chips and text. Rows
   * (menu items, the move list) bring their own inset.
   */
  inset?: boolean
  children: ReactNode
}

/** A part of a sheet under a small heading (Planning, Organisation; When, Daypart). */
export function SheetSection({ title, inset = false, children }: SectionProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of menu items, not a form's fieldset
    <div className={`sheet-section ${inset ? 'inset' : ''}`} role="group" aria-label={title}>
      {title && (
        <p className="section-heading sheet-heading" aria-hidden="true">
          {title}
        </p>
      )}
      {children}
    </div>
  )
}

/** The hairline between parts of a sheet. */
export function SheetDivider() {
  return <hr className="sheet-divider" />
}

export interface MenuItem {
  label: string
  onSelect: () => void
  /** A 16px icon in front of the label. */
  icon?: ComponentType<{ size?: number; className?: string }>
  /** The key that does the same outside the menu, shown on the right. */
  shortcut?: string
  /** Items with the same section sit together under its heading. */
  section?: string
  /** Destructive: red, at the bottom under a hairline. */
  danger?: boolean
  /** Asks this question inside the menu before acting. */
  confirm?: string
  /** Shows this inside the menu instead of acting; `close` closes the menu. */
  panel?: (close: () => void) => ReactNode
  /** A choice among several (Today's order): shows a check mark when true. */
  checked?: boolean
}

interface Props {
  label: string
  items: MenuItem[]
  /** Open the menu towards the left (for buttons at the right edge). */
  alignEnd?: boolean
  /** Open the menu upwards (for buttons near the bottom of a scrolling pane). */
  above?: boolean
}

/** The `…` button next to a title or heading, with its actions in a small menu. */
export function MoreMenu({ label, items, alignEnd = false, above = false }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState<MenuItem | null>(null)
  const [panelLabel, setPanel] = useState<string | null>(null)
  // Look the item up on every render so its panel shows current values.
  const panel = panelLabel ? items.find((i) => i.label === panelLabel) : undefined
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = useRef(() => {
    setOpen(false)
    setAsking(null)
    setPanel(null)
  }).current
  useDismiss(open, close, root, button)

  function choose(item: MenuItem) {
    if (item.panel) {
      setPanel(item.label)
      return
    }
    if (item.confirm && asking !== item) {
      setAsking(item)
      return
    }
    close()
    item.onSelect()
  }

  return (
    <div className="more-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <EllipsisVertical size={16} aria-hidden="true" />
      </button>
      {open && (
        <Sheet
          label={label}
          role="menu"
          align={alignEnd ? 'end' : 'start'}
          side={above ? 'above' : 'below'}
          className="menu"
          onClose={close}
        >
          {panel?.panel ? (
            <>
              <button type="button" className="menu-back" onClick={() => setPanel(null)}>
                <ChevronLeft size={16} aria-hidden="true" />
                {panel.label}
              </button>
              <div className="menu-panel">{panel.panel(close)}</div>
            </>
          ) : asking ? (
            <>
              <p className="menu-question">{asking.confirm}</p>
              <MenuRow item={{ ...asking, danger: true }} onChoose={() => choose(asking)} />
              <MenuRow
                item={{ label: t('confirm.cancel'), onSelect: () => setAsking(null) }}
                onChoose={() => setAsking(null)}
              />
            </>
          ) : (
            <MenuItems items={items} onChoose={choose} />
          )}
        </Sheet>
      )}
    </div>
  )
}

/** The items of a menu: in sections under their heading, destructive ones last. */
function MenuItems({ items, onChoose }: { items: MenuItem[]; onChoose: (item: MenuItem) => void }) {
  const plain = items.filter((i) => !i.danger)
  const danger = items.filter((i) => i.danger)
  // Consecutive items with the same section form one group.
  const groups: { title: string | undefined; items: MenuItem[] }[] = []
  for (const item of plain) {
    const last = groups.at(-1)
    if (last && last.title === item.section) last.items.push(item)
    else groups.push({ title: item.section, items: [item] })
  }
  const row = (item: MenuItem) => <MenuRow key={item.label} item={item} onChoose={onChoose} />
  return (
    <>
      {groups.map((g, i) =>
        g.title ? (
          <SheetSection key={g.title} title={g.title}>
            {g.items.map(row)}
          </SheetSection>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: groups without a title keep their place
          <div key={i} className="sheet-section">
            {g.items.map(row)}
          </div>
        ),
      )}
      {plain.length > 0 && danger.length > 0 && <SheetDivider />}
      {danger.map(row)}
    </>
  )
}

/** One menu item: an icon slot, the label and, where there is one, its key on the right. */
function MenuRow({ item, onChoose }: { item: MenuItem; onChoose: (item: MenuItem) => void }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      {...(item.checked === undefined
        ? { role: 'menuitem' }
        : { role: 'menuitemradio', 'aria-checked': item.checked })}
      className={`menu-item ${item.danger ? 'danger' : ''}`}
      onClick={() => onChoose(item)}
    >
      {item.checked !== undefined ? (
        <span className="menu-check" aria-hidden="true">
          {item.checked && <Check size={14} />}
        </span>
      ) : (
        Icon && <Icon size={16} className="menu-icon" aria-hidden="true" />
      )}
      <span className="menu-label">{item.label}</span>
      {item.shortcut && <kbd className="menu-kbd">{item.shortcut}</kbd>}
    </button>
  )
}
