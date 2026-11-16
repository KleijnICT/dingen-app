import { newProject, newTag, newTask, ordersBetween, type Tag } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import {
  deleteTag,
  descendantIds,
  makeTag,
  nameIssue,
  openTaskCounts,
  type SpaceOf,
  tagTree,
  validParents,
} from './tagTree.js'

const [o1, o2, o3, o4, o5] = ordersBetween(null, null, 5) as [
  string,
  string,
  string,
  string,
  string,
]

/** werk > klant > urgent, thuis, and a deleted tag under werk. */
function sample() {
  const werk = newTag({ title: 'werk', order: o1 })
  const thuis = newTag({ title: 'thuis', order: o2 })
  const klant = newTag({ title: 'klant', order: o3, parentId: werk.id })
  const urgent = newTag({ title: 'urgent', order: o4, parentId: klant.id })
  const gone = { ...newTag({ title: 'weg', order: o5, parentId: werk.id }), deleted: true }
  return { werk, thuis, klant, urgent, gone, tags: [urgent, thuis, gone, klant, werk] }
}

const oneSpace: SpaceOf = () => 'personal'
const titles = (nodes: { tag: Tag; depth: number }[]) =>
  nodes.map((n) => `${'-'.repeat(n.depth)}${n.tag.title}`)

describe('tagTree', () => {
  it('lists parents with their children below them, in order', () => {
    const { tags } = sample()
    expect(titles(tagTree(tags))).toEqual(['werk', '-klant', '--urgent', 'thuis'])
  })

  it('shows a tag whose parent is gone at the top level', () => {
    const { tags, gone } = sample()
    const orphan = newTag({ title: 'los', order: o5, parentId: gone.id })
    expect(titles(tagTree([...tags, orphan]))).toEqual([
      'werk',
      '-klant',
      '--urgent',
      'thuis',
      'los',
    ])
  })

  it('survives a loop of parents', () => {
    const a = newTag({ title: 'a', order: o1 })
    const b = newTag({ title: 'b', order: o2, parentId: a.id })
    a.parentId = b.id
    expect(titles(tagTree([a, b]))).toEqual(['a', '-b'])
  })
})

describe('descendantIds and validParents', () => {
  it('finds every tag below a tag', () => {
    const { tags, werk, klant, urgent } = sample()
    expect(descendantIds(tags, werk.id)).toEqual(new Set([klant.id, urgent.id]))
    expect(descendantIds(tags, urgent.id).size).toBe(0)
  })

  it('never offers the tag itself or its descendants', () => {
    const { tags, klant } = sample()
    expect(titles(validParents(tags, klant, oneSpace))).toEqual(['werk', 'thuis'])
  })

  it('offers a tag of the same space only; an unplaced tag fits anywhere', () => {
    const { tags, klant, thuis } = sample()
    const spaceOf: SpaceOf = (t) =>
      t.id === thuis.id ? 'shared' : t.id === klant.id ? null : 'own'
    const urgent = tags.find((t) => t.title === 'urgent') as Tag
    // werk (same space) and klant (not placed yet); thuis is in another space.
    expect(titles(validParents(tags, urgent, spaceOf))).toEqual(['werk', '-klant'])
    // klant is not placed yet, so every space fits.
    expect(titles(validParents(tags, klant, spaceOf))).toEqual(['werk', 'thuis'])
  })
})

describe('nameIssue and makeTag', () => {
  it('refuses a blank name and a name taken in the same space', () => {
    const { tags, klant } = sample()
    expect(nameIssue(tags, klant, '   ', oneSpace)).toBe('empty')
    expect(nameIssue(tags, klant, ' WERK ', oneSpace)).toBe('taken')
    expect(nameIssue(tags, null, 'Thuis', oneSpace)).toBe('taken')
  })

  it('allows the own name, a deleted name and a name used in another space', () => {
    const { tags, klant, werk } = sample()
    expect(nameIssue(tags, klant, 'Klant', oneSpace)).toBeNull()
    expect(nameIssue(tags, klant, 'weg', oneSpace)).toBeNull()
    const spaceOf: SpaceOf = (t) => (t.id === werk.id ? 'shared' : 'own')
    expect(nameIssue(tags, klant, 'werk', spaceOf)).toBeNull()
  })

  it('makes a lowercase top-level tag at the end', () => {
    const { tags } = sample()
    const tag = makeTag(tags, '  Nieuwe   Tag ')
    expect(tag.title).toBe('nieuwe tag')
    expect(tag.parentId).toBeNull()
    expect(tag.order > o5).toBe(true)
  })
})

describe('openTaskCounts', () => {
  it('counts open tasks only, once per task', () => {
    const { werk, thuis } = sample()
    const tasks = [
      newTask({ title: 'a', tagIds: [werk.id, werk.id] }),
      newTask({ title: 'b', tagIds: [werk.id, thuis.id] }),
      newTask({ title: 'c', tagIds: [thuis.id], status: 'completed' }),
      newTask({
        title: 'template',
        tagIds: [thuis.id],
        repeat: {
          unit: 'day',
          every: 1,
          basis: 'schedule',
          weekdays: [],
          start: '2026-11-16',
          until: null,
          deadlineDays: null,
        },
      }),
    ]
    const counts = openTaskCounts(tasks)
    expect(counts.get(werk.id)).toBe(2)
    expect(counts.get(thuis.id)).toBe(1)
  })
})

describe('deleteTag', () => {
  it('takes the tag off tasks and projects, lifts its children and deletes it', () => {
    const { tags, werk, klant, thuis } = sample()
    const keep = newTask({ title: 'keep', tagIds: [thuis.id] })
    const tagged = newTask({ title: 'tagged', tagIds: [werk.id, thuis.id] })
    const project = newProject({ title: 'p', tagIds: [werk.id] })
    const writes: [string, string, Record<string, unknown>][] = []
    const writer = {
      create: () => {},
      mutate: (type: string, id: string, fields: Record<string, unknown>) =>
        writes.push([type, id, fields]),
    }
    deleteTag(writer, { tasks: [keep, tagged], projects: [project], tags }, werk.id)
    expect(writes).toEqual([
      ['task', tagged.id, { tagIds: [thuis.id] }],
      ['project', project.id, { tagIds: [] }],
      ['tag', klant.id, { parentId: null }],
      ['tag', werk.id, { deleted: true }],
    ])
  })
})
