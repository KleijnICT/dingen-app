import { Menu } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
import { drawerSwipe, NARROW_QUERY, type Point } from '../drawer.js'
import { useT } from '../i18n/index.js'

function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia?.(NARROW_QUERY)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
const narrowNow = () => window.matchMedia?.(NARROW_QUERY).matches ?? false

/** True on phone-sized screens, where the sidebar is a drawer. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, narrowNow, () => false)
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface MenuButtonProps {
  open: boolean
  onOpen: () => void
  buttonRef: RefObject<HTMLButtonElement | null>
}

/** The button top left on phones that opens the sidebar drawer. */
export function MenuButton({ open, onOpen, buttonRef }: MenuButtonProps) {
  const t = useT()
  return (
    <button
      ref={buttonRef}
      type="button"
      className="menu-button"
      aria-label={t('nav.open')}
      title={t('nav.open')}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="sidebar-drawer"
      onClick={onOpen}
    >
      <Menu size={22} strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
}

interface Props {
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Gets focus back when the drawer closes. */
  returnFocus: RefObject<HTMLElement | null>
  children: ReactNode
}

/**
 * The sidebar as a modal drawer from the left on narrow screens. Opens with
 * the menu button or a swipe from the left screen edge; closes with Escape,
 * the scrim or a swipe to the left.
 */
export function SidebarDrawer({ open, onOpen, onClose, returnFocus, children }: Props) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(open)
  const state = useRef({ open, onOpen, onClose })
  state.current = { open, onOpen, onClose }

  // Focus moves into the drawer when it opens and back to the menu button when it closes.
  useEffect(() => {
    const el = panel.current
    if (open) {
      const target = el?.querySelector<HTMLElement>('.nav-item.active') ?? el
      target?.focus()
    } else if (wasOpen.current) {
      const active = document.activeElement
      if (!active || active === document.body || el?.contains(active)) returnFocus.current?.focus()
    }
    wasOpen.current = open
  }, [open, returnFocus])

  // Swiping: right from the left screen edge opens, left closes.
  useEffect(() => {
    let start: Point | null = null
    function onStart(e: TouchEvent) {
      const touch = e.touches[0]
      start = e.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null
    }
    function onEnd(e: TouchEvent) {
      const touch = e.changedTouches[0]
      if (!start || !touch) return
      const action = drawerSwipe(state.current.open, start, { x: touch.clientX, y: touch.clientY })
      start = null
      // Another dialog (settings, search, a task) keeps the drawer shut.
      const otherDialog = document.querySelector(
        '[role="dialog"][aria-modal="true"]:not(#sidebar-drawer)',
      )
      if (action === 'open' && !otherDialog) state.current.onOpen()
      if (action === 'close') state.current.onClose()
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      // An open menu inside the drawer (New list) closes first.
      if (panel.current?.querySelector('.popover')) return
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    // Keep Tab inside the drawer while it is open.
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) return
    if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement === panel.current)
    ) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className={`drawer-host ${open ? 'open' : ''}`}>
      <div className="drawer-scrim" aria-hidden="true" onClick={onClose} />
      <div
        id="sidebar-drawer"
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        aria-label={t('nav.lists')}
        tabIndex={-1}
        inert={!open}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}
