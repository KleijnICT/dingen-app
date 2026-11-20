import { type Task, views } from '@dingen/core'
import { Check, Minus } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/index.js'
import { tagChanges, tagCoverage } from '../selection.js'
import { useEngine, useWorkspace } from '../store/context.js'
import { tagForName } from '../tags.js'
import { commitTask } from '../taskActions.js'

/**
 * Tags for one or more tasks, from the toolbar. Each tag shows whether all, some or none of
 * the tasks carry it; choosing it gives it to all of them, or takes it off when all have it.
 * A new name typed in the field becomes a tag for all of them.
 */
export function BulkTags({ tasks }: { tasks: Task[] }) {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const [draft, setDraft] = useState('')
  const tags = [...ws.tags].sort(views.byOrder)

  function apply(tagId: string) {
    // One snapshot for all of them; the sync engine pushes the changes together.
    for (const { task, tagIds } of tagChanges(tasks, tagId)) {
      commitTask(engine, ws, task, { tagIds })
    }
  }

  function add() {
    const found = tagForName(ws.tags, draft)
    if (!found) return
    if (found.created) engine.create('tag', found.tag)
    const missing = tasks.filter((task) => !task.tagIds.includes(found.tag.id))
    for (const task of missing)
      commitTask(engine, ws, task, { tagIds: [...task.tagIds, found.tag.id] })
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      add()
    } else if (e.key === 'Escape' && draft !== '') {
      e.stopPropagation()
      setDraft('')
    }
  }

  return (
    <div className="bulk-tags">
      <input
        type="text"
        className="bulk-tags-input"
        value={draft}
        placeholder={t('tags.add')}
        aria-label={t('tags.label')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {tags.length === 0 ? (
        <p className="bulk-tags-empty">{t('selection.noTags')}</p>
      ) : (
        <div className="move-list">
          {tags.map((tag) => {
            const state = tagCoverage(tasks, tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                className="move-item bulk-tag"
                aria-pressed={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                onClick={() => apply(tag.id)}
              >
                <span className="bulk-tag-mark" aria-hidden="true">
                  {state === 'all' ? (
                    <Check size={14} />
                  ) : state === 'some' ? (
                    <Minus size={14} />
                  ) : null}
                </span>
                <span>{tag.title}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Asks before deleting several selected tasks; the Delete button has focus, so Enter confirms. */
export function DeleteQuestion({
  count,
  onCancel,
  onDelete,
}: {
  count: number
  onCancel: () => void
  onDelete: () => void
}) {
  const t = useT()
  const confirm = useRef<HTMLButtonElement>(null)
  useEffect(() => confirm.current?.focus(), [])
  return (
    <div
      className="popover toolbar-popover delete-question"
      role="dialog"
      aria-label={t('selection.delete')}
    >
      <p>{t('selection.deleteQuestion', { n: count })}</p>
      <div className="delete-question-buttons">
        <button type="button" className="button-secondary" onClick={onCancel}>
          {t('confirm.cancel')}
        </button>
        <button type="button" className="button-danger" ref={confirm} onClick={onDelete}>
          {t('selection.deleteConfirm', { n: count })}
        </button>
      </div>
    </div>
  )
}
