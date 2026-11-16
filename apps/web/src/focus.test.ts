import { describe, expect, it } from 'vitest'
import { type FocusKeyInput, focusActive, focusKeyAction } from './focus.js'

const key = (o: Partial<FocusKeyInput>) =>
  focusKeyAction({
    key: 'f',
    modified: false,
    handled: false,
    typing: false,
    inPopup: false,
    inPanel: false,
    onToday: true,
    on: false,
    ...o,
  })

describe('focusKeyAction', () => {
  it('toggles with F on Today', () => {
    expect(key({})).toBe('toggle')
    expect(key({ on: true, key: 'F' })).toBe('toggle')
  })
  it('turns off with Escape only while on', () => {
    expect(key({ key: 'Escape', on: true })).toBe('off')
    expect(key({ key: 'Escape' })).toBeNull()
  })
  it('leaves keys to the panel, popups, fields and other handlers', () => {
    for (const o of [{ handled: true }, { typing: true }, { inPopup: true }, { inPanel: true }]) {
      expect(key({ key: 'Escape', on: true, ...o })).toBeNull()
      expect(key(o)).toBeNull()
    }
  })
  it('ignores modified keys and other lists', () => {
    expect(key({ modified: true })).toBeNull()
    expect(key({ onToday: false, on: true, key: 'Escape' })).toBeNull()
  })
})

describe('focusActive', () => {
  it('only counts on Today', () => {
    expect(focusActive(true, 'today')).toBe(true)
    expect(focusActive(true, 'inbox')).toBe(false)
    expect(focusActive(true, undefined)).toBe(false)
    expect(focusActive(false, 'today')).toBe(false)
  })
})
