import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/index.js'

interface Props {
  onAdd: (title: string) => void
  /** Increments when someone presses `n`; puts the cursor in the field. */
  focusSignal: number
}

export function QuickAdd({ onAdd, focusSignal }: Props) {
  const t = useT()
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusSignal > 0) ref.current?.focus()
  }, [focusSignal])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && title.trim()) {
      onAdd(title.trim())
      setTitle('')
    }
    if (e.key === 'Escape') {
      setTitle('')
      ref.current?.blur()
    }
  }

  return (
    <div className="quick-add">
      <span className="quick-add-plus" aria-hidden>
        +
      </span>
      <input
        ref={ref}
        type="text"
        value={title}
        placeholder={t('task.new')}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={t('task.new')}
      />
    </div>
  )
}
