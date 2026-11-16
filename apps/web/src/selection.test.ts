import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  extendSelection,
  nextAfterRemoval,
  pruneSelection,
  selectOne,
  selectRange,
  tagChanges,
  tagCoverage,
  toggleInSelection,
} from './selection.js'

const order = ['a', 'b', 'c', 'd', 'e']

describe('selectOne', () => {
  it('selects just that task, or nothing', () => {
    expect(selectOne('b')).toEqual({ ids: ['b'], anchor: 'b', focus: 'b' })
    expect(selectOne(null)).toBe(EMPTY_SELECTION)
  })
})

describe('toggleInSelection', () => {
  it('adds a task in screen order and makes it the anchor', () => {
    const sel = toggleInSelection(selectOne('d'), 'b', order)
    expect(sel).toEqual({ ids: ['b', 'd'], anchor: 'b', focus: 'b' })
  })

  it('takes a selected task out; anchor and focus fall back to the last one left', () => {
    const sel = toggleInSelection({ ids: ['a', 'c', 'e'], anchor: 'e', focus: 'e' }, 'e', order)
    expect(sel).toEqual({ ids: ['a', 'c'], anchor: 'c', focus: 'c' })
  })

  it('can empty the selection', () => {
    expect(toggleInSelection(selectOne('a'), 'a', order)).toEqual({
      ids: [],
      anchor: null,
      focus: null,
    })
  })

  it('starts from nothing', () => {
    expect(toggleInSelection(EMPTY_SELECTION, 'c', order).ids).toEqual(['c'])
  })
})

describe('selectRange', () => {
  it('selects from the anchor to the clicked row, down or up', () => {
    expect(selectRange(selectOne('b'), 'd', order)).toEqual({
      ids: ['b', 'c', 'd'],
      anchor: 'b',
      focus: 'd',
    })
    expect(selectRange(selectOne('d'), 'a', order).ids).toEqual(['a', 'b', 'c', 'd'])
  })

  it('replaces the earlier range from the same anchor', () => {
    const first = selectRange(selectOne('c'), 'e', order)
    expect(selectRange(first, 'a', order).ids).toEqual(['a', 'b', 'c'])
  })

  it('is just the clicked row without an anchor on screen', () => {
    expect(selectRange(EMPTY_SELECTION, 'c', order)).toEqual(selectOne('c'))
    expect(selectRange(selectOne('gone'), 'c', order)).toEqual(selectOne('c'))
  })
})

describe('extendSelection', () => {
  it('grows and shrinks the range from the anchor with each step', () => {
    let sel = extendSelection(selectOne('b'), 'down', order)
    expect(sel?.ids).toEqual(['b', 'c'])
    sel = extendSelection(sel ?? EMPTY_SELECTION, 'down', order)
    expect(sel).toEqual({ ids: ['b', 'c', 'd'], anchor: 'b', focus: 'd' })
    sel = extendSelection(sel ?? EMPTY_SELECTION, 'up', order)
    expect(sel?.ids).toEqual(['b', 'c'])
    sel = extendSelection(sel ?? EMPTY_SELECTION, 'up', order)
    sel = extendSelection(sel ?? EMPTY_SELECTION, 'up', order)
    expect(sel).toEqual({ ids: ['a', 'b'], anchor: 'b', focus: 'a' })
  })

  it('starts at the top or the bottom without a selection', () => {
    expect(extendSelection(EMPTY_SELECTION, 'down', order)).toEqual(selectOne('a'))
    expect(extendSelection(EMPTY_SELECTION, 'up', order)).toEqual(selectOne('e'))
  })

  it('stops at the ends and in an empty list', () => {
    expect(extendSelection(selectOne('e'), 'down', order)).toBeNull()
    expect(extendSelection(selectOne('a'), 'up', order)).toBeNull()
    expect(extendSelection(EMPTY_SELECTION, 'down', [])).toBeNull()
  })

  it('anchors on the focus when the anchor has left the screen', () => {
    expect(extendSelection({ ids: ['c'], anchor: 'gone', focus: 'c' }, 'down', order)?.ids).toEqual(
      ['c', 'd'],
    )
  })
})

describe('pruneSelection', () => {
  it('drops tasks that are gone and keeps the same object when none are', () => {
    const sel = { ids: ['a', 'b', 'c'], anchor: 'a', focus: 'c' }
    expect(pruneSelection(sel, new Set(order))).toBe(sel)
    expect(pruneSelection(sel, new Set(['b', 'd']))).toEqual({
      ids: ['b'],
      anchor: 'b',
      focus: 'b',
    })
    expect(pruneSelection(sel, new Set(['a', 'b']))).toEqual({
      ids: ['a', 'b'],
      anchor: 'a',
      focus: 'b',
    })
  })

  it('ends empty when all are gone', () => {
    expect(pruneSelection(selectOne('a'), new Set())).toEqual({
      ids: [],
      anchor: null,
      focus: null,
    })
  })
})

describe('nextAfterRemoval', () => {
  it('is the first row below the selection that stays', () => {
    expect(nextAfterRemoval(['b', 'c'], order)).toBe('d')
    expect(nextAfterRemoval(['a', 'c'], order)).toBe('d')
  })

  it('is the nearest row above when nothing is below', () => {
    expect(nextAfterRemoval(['d', 'e'], order)).toBe('c')
  })

  it('is nothing when every row goes or none is on screen', () => {
    expect(nextAfterRemoval(order, order)).toBeNull()
    expect(nextAfterRemoval(['x'], order)).toBeNull()
  })
})

describe('tags for a selection', () => {
  const tasks = [
    { id: '1', tagIds: ['home'] },
    { id: '2', tagIds: ['home', 'calls'] },
    { id: '3', tagIds: [] },
  ]

  it('says whether all, some or none carry a tag', () => {
    expect(tagCoverage(tasks, 'home')).toBe('some')
    expect(tagCoverage(tasks, 'calls')).toBe('some')
    expect(tagCoverage(tasks, 'errands')).toBe('none')
    expect(tagCoverage(tasks.slice(0, 2), 'home')).toBe('all')
  })

  it('adds a tag to the tasks without it', () => {
    expect(tagChanges(tasks, 'home')).toEqual([{ task: tasks[2], tagIds: ['home'] }])
  })

  it('takes a tag off all of them when all carry it', () => {
    expect(tagChanges(tasks.slice(0, 2), 'home')).toEqual([
      { task: tasks[0], tagIds: [] },
      { task: tasks[1], tagIds: ['calls'] },
    ])
  })
})
