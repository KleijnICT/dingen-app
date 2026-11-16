import { describe, expect, it } from 'vitest'
import { drawerSwipe, startsAtEdge, swipeDirection } from './drawer.js'

describe('startsAtEdge', () => {
  it('accepts touches on the left edge only', () => {
    expect(startsAtEdge(0)).toBe(true)
    expect(startsAtEdge(24)).toBe(true)
    expect(startsAtEdge(25)).toBe(false)
    expect(startsAtEdge(200)).toBe(false)
    expect(startsAtEdge(-1)).toBe(false)
  })
})

describe('swipeDirection', () => {
  it('needs enough sideways travel', () => {
    expect(swipeDirection({ x: 10, y: 100 }, { x: 40, y: 100 })).toBeNull()
    expect(swipeDirection({ x: 10, y: 100 }, { x: 90, y: 110 })).toBe('right')
    expect(swipeDirection({ x: 200, y: 100 }, { x: 100, y: 90 })).toBe('left')
  })
  it('ignores mostly vertical moves', () => {
    expect(swipeDirection({ x: 10, y: 100 }, { x: 80, y: 200 })).toBeNull()
  })
})

describe('drawerSwipe', () => {
  it('opens with a swipe from the left edge', () => {
    expect(drawerSwipe(false, { x: 8, y: 300 }, { x: 120, y: 310 })).toBe('open')
  })
  it('does not open from the middle of the screen', () => {
    expect(drawerSwipe(false, { x: 150, y: 300 }, { x: 300, y: 300 })).toBeNull()
  })
  it('closes with a leftward swipe while open', () => {
    expect(drawerSwipe(true, { x: 250, y: 300 }, { x: 100, y: 300 })).toBe('close')
    expect(drawerSwipe(true, { x: 8, y: 300 }, { x: 120, y: 300 })).toBeNull()
  })
  it('leaves a closed drawer alone on a leftward swipe', () => {
    expect(drawerSwipe(false, { x: 250, y: 300 }, { x: 100, y: 300 })).toBeNull()
  })
})
