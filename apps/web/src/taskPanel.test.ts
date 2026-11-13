import { newTask } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import {
  fieldLayout,
  type KeyInput,
  listKeyAction,
  panelMode,
  rowClickAction,
  stillAdded,
  taskParamOf,
  withTaskParam,
} from './taskPanel.js'

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

describe('rowClickAction', () => {
  it('selects with a mouse while the panel is closed', () => {
    expect(rowClickAction(false, false)).toBe('select')
  })
  it('opens on a touch screen', () => {
    expect(rowClickAction(true, false)).toBe('open')
  })
  it('shows the clicked task when the panel is already open', () => {
    expect(rowClickAction(false, true)).toBe('open')
  })
})

describe('fieldLayout', () => {
  const plain = newTask({ title: 'Plain', when: { kind: 'anytime' } })
  const dated = newTask({ title: 'Dated', when: { kind: 'date', date: '2026-11-13' } })

  it('offers every applicable empty field and shows none', () => {
    expect(fieldLayout(dated, [], true)).toEqual({
      shown: [],
      addable: ['time', 'deadline', 'repeat', 'assignee'],
    })
  })

  it('offers a time only for a task with a date', () => {
    expect(fieldLayout(plain, [], true).addable).toEqual(['deadline', 'repeat', 'assignee'])
    expect(fieldLayout(plain, ['time'], true).shown).toEqual([])
  })

  it('offers assigning only when there is someone to assign to', () => {
    expect(fieldLayout(plain, [], false).addable).toEqual(['deadline', 'repeat'])
    expect(fieldLayout({ ...plain, assigneeId: 'agent:a' }, [], false).shown).toEqual(['assignee'])
  })

  it('shows fields with a value and keeps them out of the Add row', () => {
    const full = {
      ...dated,
      time: '09:00',
      deadline: '2026-11-20',
      templateId: 'tpl',
      assigneeId: 'me',
    }
    expect(fieldLayout(full, [], true)).toEqual({
      shown: ['time', 'deadline', 'repeat', 'assignee'],
      addable: [],
    })
    // A reminder alone counts as a time and reminder.
    expect(
      fieldLayout({ ...dated, reminder: { daysBefore: 0, time: '09:00' } }, [], true).shown,
    ).toEqual(['time'])
  })

  it('shows a just added field before it has a value', () => {
    expect(fieldLayout(plain, ['deadline'], true)).toEqual({
      shown: ['deadline'],
      addable: ['repeat', 'assignee'],
    })
  })

  it('does not start repeating a completed task', () => {
    const done = { ...plain, status: 'completed' as const }
    expect(fieldLayout(done, [], false).addable).toEqual(['deadline'])
    expect(fieldLayout({ ...done, templateId: 'tpl' }, [], false).shown).toEqual(['repeat'])
  })

  it('forgets an added field once it has a value, so clearing it hides it again', () => {
    const withDeadline = { ...plain, deadline: '2026-11-20' }
    expect(stillAdded(withDeadline, ['deadline', 'repeat'])).toEqual(['repeat'])
    expect(fieldLayout(plain, stillAdded(withDeadline, ['deadline']), true).shown).toEqual([])
  })
})
