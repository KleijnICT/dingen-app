import { type PointerEvent, useEffect, useRef } from 'react'

/** How long a finger rests on a row before it counts as a long press. */
export const LONG_PRESS_MS = 500
/** How far the finger may drift (scrolling) before the press no longer counts. */
const SLOP_PX = 10

/**
 * A long press with a finger (or pen) on an element. Returns pointer handlers to spread on it,
 * and `consumeClick`, which the element's click handler calls first: true once, right after a
 * long press, so the tap that ends it does not also count as a click.
 */
export function useLongPress(onLongPress: (() => void) | undefined): {
  handlers: {
    onPointerDown?: (e: PointerEvent) => void
    onPointerMove?: (e: PointerEvent) => void
    onPointerUp?: () => void
    onPointerCancel?: () => void
    onContextMenu?: (e: { preventDefault: () => void }) => void
  }
  consumeClick: () => boolean
} {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const latest = useRef(onLongPress)
  latest.current = onLongPress

  useEffect(() => () => clearTimeout(timer.current), [])

  const cancel = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    start.current = null
  }

  if (!onLongPress) return { handlers: {}, consumeClick: () => false }

  return {
    handlers: {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' || !e.isPrimary) return
        cancel()
        fired.current = false
        start.current = { x: e.clientX, y: e.clientY }
        timer.current = setTimeout(() => {
          timer.current = undefined
          fired.current = true
          navigator.vibrate?.(10)
          latest.current?.()
        }, LONG_PRESS_MS)
      },
      onPointerMove: (e) => {
        const from = start.current
        if (!from || !timer.current) return
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP_PX) cancel()
      },
      onPointerUp: () => {
        clearTimeout(timer.current)
        timer.current = undefined
      },
      onPointerCancel: cancel,
      // The long press itself should not open the browser's menu for the row.
      onContextMenu: (e) => {
        if (fired.current || timer.current) e.preventDefault()
      },
    },
    consumeClick: () => {
      if (!fired.current) return false
      fired.current = false
      return true
    },
  }
}
