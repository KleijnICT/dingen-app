import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { dragWidth, type Edge, keyWidth, maxWidth, type WidthLimits } from '../resize.js'

/** Two taps this close together (in time and place) reset the width, like a double click. */
const DOUBLE_TAP_MS = 350
const TAP_SLOP = 6

interface Props {
  className: string
  label: string
  /** The current width of the part this handle resizes. */
  width: number
  limits: WidthLimits
  /** Which edge of the part the handle sits on. */
  edge: Edge
  /** The window width minus whatever else sits beside the list, for the list's minimum. */
  room: () => number
  /** A new width, or null for the default. */
  onChange: (width: number | null) => void
}

/**
 * A thin, focusable separator on the edge of the sidebar or the task panel. Drag it with a
 * mouse, finger or pen; double-click or double-tap puts the default width back; the arrow
 * keys move it in steps.
 */
export function ResizeHandle({ className, label, width, limits, edge, room, onChange }: Props) {
  const [dragging, setDragging] = useState(false)
  const lastTap = useRef<{ at: number; x: number } | null>(null)
  const frame = useRef(0)
  const max = maxWidth(limits, room())

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    handle.focus({ preventScroll: true })
    const startX = e.clientX
    const startWidth = width
    const dragMax = maxWidth(limits, room())
    let moved = false
    setDragging(true)
    document.documentElement.classList.add('resizing')

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const dx = ev.clientX - startX
      if (Math.abs(dx) > TAP_SLOP) moved = true
      // One update per frame keeps a fast drag smooth.
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() =>
        onChange(dragWidth(startWidth, dx, edge, limits.min, dragMax)),
      )
    }
    const stop = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      setDragging(false)
      document.documentElement.classList.remove('resizing')
      if (moved || ev.type === 'pointercancel') {
        lastTap.current = null
        return
      }
      // A tap: two in a row put the default width back.
      const tap = { at: ev.timeStamp, x: ev.clientX }
      const prev = lastTap.current
      if (prev && tap.at - prev.at < DOUBLE_TAP_MS && Math.abs(tap.x - prev.x) <= TAP_SLOP) {
        cancelAnimationFrame(frame.current)
        onChange(null)
        lastTap.current = null
      } else lastTap.current = tap
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onChange(null)
      return
    }
    const next = keyWidth(e.key, e.shiftKey, width, edge, limits.min, max)
    if (next === null) return
    e.preventDefault()
    onChange(next)
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged or focused
    <div
      className={`resize-handle ${edge} ${className}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.min(width, max)}
      aria-valuemin={limits.min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
