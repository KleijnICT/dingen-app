import type { Tag } from '@dingen/core'
import { views } from '@dingen/core'
import { useT } from '../i18n/index.js'
import { useWorkspace } from '../store/context.js'

/** The tags among `present` that still exist, in tag order. */
export function useFilterTags(present: Set<string>): Tag[] {
  const ws = useWorkspace()
  return [...present]
    .map((id) => ws.tagById.get(id))
    .filter((x): x is Tag => Boolean(x))
    .sort(views.byOrder)
}

interface Props {
  /** Tag ids that occur in the list being shown. */
  present: Set<string>
  active: string | null
  onChange: (tagId: string | null) => void
}

/**
 * The tags in use on this list, inside the page's filter popover; one can be active.
 * Hidden when there are none.
 */
export function TagFilter({ present, active, onChange }: Props) {
  const t = useT()
  const tags = useFilterTags(present)
  if (tags.length === 0 && active === null) return null
  return (
    <fieldset className="filter-chips" aria-label={t('tags.label')}>
      <button
        type="button"
        className={`chip small ${active === null ? 'active' : ''}`}
        aria-pressed={active === null}
        onClick={() => onChange(null)}
      >
        {t('tags.all')}
      </button>
      {tags.map((tag) => (
        <button
          type="button"
          key={tag.id}
          className={`chip small ${active === tag.id ? 'active' : ''}`}
          aria-pressed={active === tag.id}
          onClick={() => onChange(active === tag.id ? null : tag.id)}
        >
          {tag.title}
        </button>
      ))}
    </fieldset>
  )
}
