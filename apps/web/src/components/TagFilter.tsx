import type { Tag } from '@dingen/core'
import { views } from '@dingen/core'
import { useT } from '../i18n/index.js'
import { useWorkspace } from '../store/context.js'
import { TagIcon } from './Icons.js'

interface Props {
  /** Tag ids that occur in the list being shown. */
  present: Set<string>
  active: string | null
  onChange: (tagId: string | null) => void
}

/** The tags in use on this list; one can be active. Hidden when there are none. */
export function TagFilter({ present, active, onChange }: Props) {
  const t = useT()
  const ws = useWorkspace()
  const tags = [...present]
    .map((id) => ws.tagById.get(id))
    .filter((x): x is Tag => Boolean(x))
    .sort(views.byOrder)
  if (tags.length === 0 && active === null) return null
  return (
    <fieldset className="tag-filter" aria-label={t('tags.label')}>
      <TagIcon className="meta-icon" />
      <button
        type="button"
        className={`chip small ${active === null ? 'active' : ''}`}
        onClick={() => onChange(null)}
      >
        {t('tags.all')}
      </button>
      {tags.map((tag) => (
        <button
          type="button"
          key={tag.id}
          className={`chip small ${active === tag.id ? 'active' : ''}`}
          onClick={() => onChange(active === tag.id ? null : tag.id)}
        >
          {tag.title}
        </button>
      ))}
    </fieldset>
  )
}
