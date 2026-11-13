import { describe, expect, it } from 'vitest'
import { type KeyInput, listKeyAction, panelMode, taskParamOf, withTaskParam } from './taskPanel.js'

const base: KeyInput = {
  key: 'ArrowDown',
  modified: false,
  typing: false,
  inPopup: false,
  inPanel: false,
  onPanel: false,
  inList: false,
  onButton: false,
  selected: null,
  open: null,
  ids: ['a', 'b', 'c'],
}
const key = (k: Partial<KeyInput>) => listKeyAction({ ...base, ...k })

describe('panelMode', () => {
  it('sits beside the list from 1200px, over it from 720px, full screen below', () => {
    expect(panelMode(1400)).toBe('side')
    expect(panelMode(1200)).toBe('side')
    expect(panelMode(1199)).toBe('overlay')
    expect(panelMode(1000)).toBe('overlay')
    expect(panelMode(720)).toBe('overlay')
    expect(panelMode(719)).toBe('full')
    expect(panelMode(390)).toBe('full')
  })
})

describe('listKeyAction', () => {
  it('moves the selection with the arrows, starting at the top', () => {
    expect(key({})).toEqual({ kind: 'move', id: 'a' })
    expect(key({ selected: 'a' })).toEqual({ kind: 'move', id: 'b' })
    expect(key({ key: 'ArrowUp', selected: 'b' })).toEqual({ kind: 'move', id: 'a' })
    expect(key({ key: 'ArrowUp' })).toEqual({ kind: 'move', id: 'a' })
  })

  it('stops at the ends and does nothing in an empty list', () => {
    expect(key({ selected: 'c' })).toBeNull()
    expect(key({ key: 'ArrowUp', selected: 'a' })).toBeNull()
    expect(key({ ids: [] })).toBeNull()
  })

  it('moves with the panel open, from the list or from the panel itself', () => {
    expect(key({ selected: 'a', open: 'a' })).toEqual({ kind: 'move', id: 'b' })
    expect(key({ selected: 'a', open: 'a', onPanel: true })).toEqual({ kind: 'move', id: 'b' })
  })

  it('leaves the arrows alone while typing or inside the panel', () => {
    expect(key({ selected: 'a', open: 'a', typing: true, inPanel: true })).toBeNull()
    expect(key({ selected: 'a', open: 'a', inPanel: true })).toBeNull()
    expect(key({ selected: 'a', typing: true })).toBeNull()
  })

  it('ignores keys with a modifier or inside a popup', () => {
    expect(key({ modified: true })).toBeNull()
    expect(key({ inPopup: true })).toBeNull()
    expect(key({ key: 'Escape', open: 'a', inPopup: true })).toBeNull()
  })

  it('opens the selection with Enter, unless a button takes the Enter itself', () => {
    expect(key({ key: 'Enter', selected: 'b' })).toEqual({ kind: 'open', id: 'b' })
    expect(key({ key: 'Enter', selected: 'b', onButton: true })).toBeNull()
    expect(key({ key: 'Enter', selected: 'b', open: 'b' })).toBeNull()
    expect(key({ key: 'Enter' })).toBeNull()
  })

  it('closes the panel with Escape, also from a field in it, and keeps the selection', () => {
    expect(key({ key: 'Escape', selected: 'a', open: 'a' })).toEqual({ kind: 'close' })
    expect(key({ key: 'Escape', open: 'a', inPanel: true, typing: true })).toEqual({
      kind: 'close',
    })
  })

  it('clears the selection with Escape when the panel is closed', () => {
    expect(key({ key: 'Escape', selected: 'a' })).toEqual({ kind: 'deselect' })
    expect(key({ key: 'Escape' })).toBeNull()
    // A field in the list (renaming a heading) keeps its own Escape.
    expect(key({ key: 'Escape', selected: 'a', typing: true })).toBeNull()
  })

  it('deletes the selection and selects the next row, or the one before the last', () => {
    expect(key({ key: 'Backspace', selected: 'b' })).toEqual({
      kind: 'delete',
      id: 'b',
      next: 'c',
    })
    expect(key({ key: 'Delete', selected: 'c' })).toEqual({ kind: 'delete', id: 'c', next: 'b' })
    expect(key({ key: 'Delete', selected: 'a', ids: ['a'] })).toEqual({
      kind: 'delete',
      id: 'a',
      next: null,
    })
  })

  it('does not delete from the panel or while typing', () => {
    expect(key({ key: 'Backspace', selected: 'a', open: 'a', onPanel: true })).toBeNull()
    expect(key({ key: 'Backspace', selected: 'a', open: 'a', inPanel: true })).toBeNull()
    expect(key({ key: 'Backspace', selected: 'a', typing: true })).toBeNull()
    expect(key({ key: 'Backspace', selected: 'x' })).toBeNull()
  })

  it('deletes the open task only with focus in the list', () => {
    expect(key({ key: 'Delete', selected: 'a', open: 'a' })).toBeNull()
    expect(key({ key: 'Delete', selected: 'a', open: 'a', inList: true })).toEqual({
      kind: 'delete',
      id: 'a',
      next: 'b',
    })
  })
})

describe('task parameter', () => {
  it('sets and clears ?task= and keeps other parameters', () => {
    expect(withTaskParam('', 'abc')).toBe('?task=abc')
    expect(withTaskParam('?task=abc', 'def')).toBe('?task=def')
    expect(withTaskParam('?task=abc', null)).toBe('')
    expect(withTaskParam('?x=1&task=abc', null)).toBe('?x=1')
    expect(withTaskParam('?x=1', 'abc')).toBe('?x=1&task=abc')
  })

  it('reads the open task', () => {
    expect(taskParamOf('?task=abc')).toBe('abc')
    expect(taskParamOf('?task=')).toBeNull()
    expect(taskParamOf('')).toBeNull()
  })
})
