import { type KeyboardEvent, useEffect, useState } from 'react'

interface Props {
  value: string
  onCommit: (value: string) => void
  className?: string
  placeholder?: string
  'aria-label'?: string
  autoFocus?: boolean
  multiline?: boolean
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
}: Props) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)

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
