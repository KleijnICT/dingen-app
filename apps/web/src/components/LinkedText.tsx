import {
  type ChangeEvent,
  type MouseEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { tokenizeLinks } from '../linkify.js'

/** Text with its http(s) links as anchors; everything else is plain text, never markup. */
export function LinkedText({ text }: { text: string }) {
  let at = 0
  return tokenizeLinks(text).map((token) => {
    const key = at
    at += token.text.length
    if (token.type === 'text') return token.text
    return (
      <a
        key={key}
        className="text-link"
        href={token.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {token.text}
      </a>
    )
  })
}

/** The text offset under a point on the page, or null when the browser cannot say. */
function offsetAt(root: HTMLElement, x: number, y: number): number | null {
  let node: Node | null = null
  let offset = 0
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y)
    node = pos?.offsetNode ?? null
    offset = pos?.offset ?? 0
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y)
    node = range?.startContainer ?? null
    offset = range?.startOffset ?? 0
  }
  if (!node || !root.contains(node)) return null
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}

interface Props {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  placeholder: string
  label: string
  /** The text area, for the parent to focus. */
  textareaRef: RefObject<HTMLTextAreaElement | null>
  /** Changes when the width does, so the height follows. */
  growKey?: unknown
}

/**
 * Notes as a text area that grows with its text. Without focus, notes holding a link show as
 * text with clickable links, laid out like the text area; a click elsewhere on the text, or
 * Tab, goes back to editing with the caret where it was clicked.
 */
export function LinkedNotes({
  value,
  onChange,
  onBlur,
  placeholder,
  label,
  textareaRef,
  growKey,
}: Props) {
  const [editing, setEditing] = useState(false)
  const caret = useRef<number | null>(null)
  const linked = tokenizeLinks(value).some((tk) => tk.type === 'link')
  const view = linked && !editing

  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows text and width
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [textareaRef, value, growKey, view])

  // Coming back to editing: focus with the caret where the click was (default: the end).
  useLayoutEffect(() => {
    if (!editing || caret.current === null) return
    const el = textareaRef.current
    const pos = Math.min(caret.current, el?.value.length ?? 0)
    caret.current = null
    el?.focus()
    el?.setSelectionRange(pos, pos)
  }, [editing, textareaRef])

  function edit(pos: number | null) {
    caret.current = pos ?? value.length
    setEditing(true)
  }

  function onClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('a')) return
    if (!window.getSelection()?.isCollapsed) return
    edit(offsetAt(e.currentTarget, e.clientX, e.clientY))
  }

  if (view) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: it stands in for the text area; focus or a click edits
      <div
        className="editor-notes editor-notes-view"
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) edit(null)
        }}
        onFocus={(e) => {
          if (e.target === e.currentTarget) edit(null)
        }}
      >
        <LinkedText text={value} />
        {value.endsWith('\n') && '​'}
      </div>
    )
  }
  return (
    <textarea
      ref={textareaRef}
      className="editor-notes"
      rows={2}
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false)
        onBlur()
      }}
      placeholder={placeholder}
      aria-label={label}
    />
  )
}
