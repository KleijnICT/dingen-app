import { newTag, orderBetween, type Tag, views } from '@dingen/core'
import { type KeyboardEvent, useId, useState } from 'react'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'

interface Props {
  tagIds: string[]
  onChange: (tagIds: string[]) => void
}

/** Chips for the current tags plus a field that suggests existing tags and creates new ones. */
export function TagEditor({ tagIds, onChange }: Props) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const [draft, setDraft] = useState('')
  const listId = useId()
  const current = tagIds.map((id) => ws.tagById.get(id)).filter((x): x is Tag => Boolean(x))
  const available = ws.tags.filter((tag) => !tagIds.includes(tag.id)).sort(views.byOrder)

  function add(title: string) {
    const clean = title.trim()
    if (!clean) return
    let tag = ws.tags.find((x) => x.title.toLowerCase() === clean.toLowerCase())
    if (!tag) {
      const last = [...ws.tags].sort(views.byOrder).at(-1)
      tag = newTag({ title: clean, order: orderBetween(last?.order ?? null, null) })
      engine.create('tag', tag)
    }
    if (!tagIds.includes(tag.id)) onChange([...tagIds, tag.id])
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      add(draft)
    } else if (e.key === 'Backspace' && draft === '' && tagIds.length > 0) {
      onChange(tagIds.slice(0, -1))
    } else if (e.key === 'Escape' && draft !== '') {
      e.stopPropagation()
      setDraft('')
    }
  }

  return (
    <div className="tag-editor">
      {current.map((tag) => (
        <span key={tag.id} className="tag-chip">
          {tag.title}
          <button
            type="button"
            className="tag-remove"
            aria-label={t('tags.remove', { name: tag.title })}
            onClick={() => onChange(tagIds.filter((id) => id !== tag.id))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className="tag-input"
        list={listId}
        value={draft}
        placeholder={t('tags.add')}
        aria-label={t('tags.label')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={listId}>
        {available.map((tag) => (
          <option key={tag.id} value={tag.title} />
        ))}
      </datalist>
    </div>
  )
}
