import { Ellipsis } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
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

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  /** Asks this question inside the menu before acting. */
  confirm?: string
}

interface Props {
  label: string
  items: MenuItem[]
  /** Open the menu towards the left (for buttons at the right edge). */
  alignEnd?: boolean
}

/** The `…` button next to a title or heading, with its actions in a small menu. */
export function MoreMenu({ label, items, alignEnd = false }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState<MenuItem | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = useRef(() => {
    setOpen(false)
    setAsking(null)
  }).current
  useDismiss(open, close, root, button)

  function choose(item: MenuItem) {
    if (item.confirm && asking !== item) {
      setAsking(item)
      return
    }
    close()
    item.onSelect()
  }

  return (
    <div className={`more-menu ${alignEnd ? 'end' : ''}`} ref={root}>
      <button
        type="button"
        ref={button}
        className="more-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Ellipsis size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="popover menu" role="menu" aria-label={label}>
          {asking ? (
            <>
              <p className="menu-question">{asking.confirm}</p>
              <button
                type="button"
                role="menuitem"
                className="menu-item danger"
                onClick={() => choose(asking)}
              >
                {asking.label}
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => setAsking(null)}
              >
                {t('confirm.cancel')}
              </button>
            </>
          ) : (
            items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                onClick={() => choose(item)}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
