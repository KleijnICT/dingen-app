import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onCommit: (value: string) => void
  className?: string
  placeholder?: string
  'aria-label'?: string
  autoFocus?: boolean
  multiline?: boolean
  /** One line of text that wraps onto more lines when it is long (page titles). */
  wrap?: boolean
}

/**
 * A text field that keeps a local draft while typing and writes one change
 * when it loses focus (or on Enter for a single line). Escape reverts.
 */
export function InlineInput({
  value,
  onCommit,
  className,
  placeholder,
  'aria-label': ariaLabel,
  autoFocus = false,
  multiline = false,
  wrap = false,
}: Props) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  // A wrapping title grows with its text, so a long one never scrolls or gets cut off.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the text
  useLayoutEffect(() => {
    const el = area.current
    if (!wrap || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [wrap, draft])

  // Follow outside changes (another device) while not typing.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      setDraft(value)
      setEditing(false)
      e.currentTarget.blur()
    } else if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  const shared = {
    className,
    placeholder,
    'aria-label': ariaLabel,
    value: draft,
    onFocus: () => setEditing(true),
    onBlur: commit,
    onKeyDown,
  }
  if (wrap) {
    return (
      <textarea
        {...shared}
        ref={area}
        rows={1}
        // biome-ignore lint/a11y/noAutofocus: a new item needs its title right away
        autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value.replace(/\s*\n\s*/g, ' '))}
      />
    )
  }
  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={draft ? Math.min(12, draft.split('\n').length + 1) : 1}
        onChange={(e) => setDraft(e.target.value)}
      />
    )
  }
  return (
    <input
      {...shared}
      // biome-ignore lint/a11y/noAutofocus: a new item needs its title right away
      autoFocus={autoFocus}
      onChange={(e) => setDraft(e.target.value)}
    />
  )
}
