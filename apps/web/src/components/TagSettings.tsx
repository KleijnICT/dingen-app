import { normalizeTagTitle, recordKey, type Tag } from '@dingen/core'
import { CornerDownRight } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useMemo, useState } from 'react'
import { useT } from '../i18n/index.js'
import { useEngine, useWorkspace } from '../store/context.js'
import {
  deleteTag,
  descendantIds,
  makeTag,
  type NameIssue,
  nameIssue,
  openTaskCounts,
  type SpaceOf,
  tagTree,
  validParents,
} from '../tagTree.js'
import { MoreMenu } from './Menu.js'

/**
 * Settings → Tags: every tag as a tree with its number of open tasks. Create
 * at the top, rename inline, move under another tag, delete. All writes go
 * through the sync engine; names are always lowercase.
 */
export function TagSettings() {
  const t = useT()
  const engine = useEngine()
  const ws = useWorkspace()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const spaceOf: SpaceOf = (tag) => engine.records.get(recordKey('tag', tag.id))?.spaceId ?? null
  const tree = useMemo(() => tagTree(ws.tags), [ws.tags])
  const counts = useMemo(() => openTaskCounts(ws.tasks), [ws.tasks])

  function issueText(issue: NameIssue, typed: string): string | null {
    return issue === 'taken' ? t('tagSettings.taken', { name: normalizeTagTitle(typed) }) : null
  }

  function create(e: FormEvent) {
    e.preventDefault()
    const issue = nameIssue(ws.tags, null, draft, spaceOf)
    if (issue) {
      setError(issueText(issue, draft))
      return
    }
    engine.create('tag', makeTag(ws.tags, draft))
    setDraft('')
    setError(null)
  }

  /** Saves a new name; false (with a message) when the name cannot be used. */
  function rename(tag: Tag, typed: string): boolean {
    const issue = nameIssue(ws.tags, tag, typed, spaceOf)
    if (issue) {
      setError(issueText(issue, typed))
      return false
    }
    const title = normalizeTagTitle(typed)
    if (title !== tag.title) engine.mutate('tag', tag.id, { title })
    setError(null)
    return true
  }

  return (
    <div className="settings-form tag-settings">
      <form className="tag-settings-add" onSubmit={create}>
        <input
          type="text"
          value={draft}
          placeholder={t('tagSettings.new')}
          aria-label={t('tagSettings.new')}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
        />
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tree.length === 0 ? (
        <p className="muted">{t('tagSettings.empty')}</p>
      ) : (
        <ul className="tag-settings-list">
          {tree.map(({ tag, depth }, index) => (
            <TagItem
              key={tag.id}
              tag={tag}
              depth={depth}
              count={counts.get(tag.id) ?? 0}
              editing={editing === tag.id}
              up={index >= 4 && index >= tree.length - 3}
              onEdit={(on) => {
                setEditing(on ? tag.id : null)
                if (on) setError(null)
              }}
              onCancel={() => {
                setEditing(null)
                setError(null)
              }}
              onRename={(typed) => rename(tag, typed)}
              parents={() => validParents(ws.tags, tag, spaceOf)}
              hasChildren={descendantIds(ws.tags, tag.id).size > 0}
              onMove={(parentId) => engine.mutate('tag', tag.id, { parentId })}
              onDelete={() => deleteTag(engine, ws, tag.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface ItemProps {
  tag: Tag
  depth: number
  count: number
  editing: boolean
  /** Open the menu upwards: the row sits near the bottom of the list. */
  up: boolean
  onEdit: (on: boolean) => void
  onCancel: () => void
  onRename: (typed: string) => boolean
  parents: () => { tag: Tag; depth: number }[]
  hasChildren: boolean
  onMove: (parentId: string | null) => void
  onDelete: () => void
}

function TagItem(props: ItemProps) {
  const { tag, depth, count, editing, onEdit, onRename } = props
  const t = useT()
  const [value, setValue] = useState(tag.title)

  function start() {
    setValue(tag.title)
    onEdit(true)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (onRename(value)) onEdit(false)
    } else if (e.key === 'Escape') {
      // Only end the edit, not close Settings.
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      props.onCancel()
    }
  }

  return (
    <li className={`tag-settings-item ${props.up ? 'up' : ''}`} style={{ paddingLeft: depth * 22 }}>
      {depth > 0 && (
        <CornerDownRight size={14} className="tag-settings-branch" aria-hidden="true" />
      )}
      {editing ? (
        <input
          className="tag-settings-name editing"
          // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to rename
          autoFocus
          value={value}
          aria-label={t('tagSettings.renameField', { name: tag.title })}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // A name that cannot be used is dropped; the message says why.
            onRename(value)
            onEdit(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="tag-settings-name"
          title={t('tagSettings.rename')}
          onClick={start}
        >
          {tag.title}
        </button>
      )}
      <span className="tag-settings-count muted" title={t('tagSettings.openTasks', { count })}>
        <span aria-hidden="true">{count}</span>
        <span className="tag-settings-hidden">{t('tagSettings.openTasks', { count })}</span>
      </span>
      <MoreMenu
        label={t('tagSettings.actions', { name: tag.title })}
        alignEnd
        items={[
          { label: t('tagSettings.rename'), onSelect: start },
          {
            label: t('tagSettings.moveUnder'),
            onSelect: () => {},
            panel: (close) => (
              <div className="move-list tag-settings-parents">
                <button
                  type="button"
                  className="move-item"
                  aria-pressed={tag.parentId === null}
                  onClick={() => {
                    props.onMove(null)
                    close()
                  }}
                >
                  <span>{t('tagSettings.topLevel')}</span>
                </button>
                {props.parents().map((n) => (
                  <button
                    key={n.tag.id}
                    type="button"
                    className="move-item"
                    style={{ paddingLeft: 8 + (n.depth + 1) * 16 }}
                    aria-pressed={tag.parentId === n.tag.id}
                    onClick={() => {
                      props.onMove(n.tag.id)
                      close()
                    }}
                  >
                    <span>{n.tag.title}</span>
                  </button>
                ))}
              </div>
            ),
          },
          {
            label: t('tagSettings.delete'),
            danger: true,
            confirm: t(props.hasChildren ? 'tagSettings.confirmParent' : 'tagSettings.confirm', {
              name: tag.title,
            }),
            onSelect: props.onDelete,
          },
        ]}
      />
    </li>
  )
}
