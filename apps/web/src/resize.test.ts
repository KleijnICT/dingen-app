import { describe, expect, it } from 'vitest'
import {
  clampWidth,
  dragWidth,
  KEY_STEP,
  KEY_STEP_LARGE,
  keyWidth,
  LIST_MIN,
  maxWidth,
  PANEL_LIMITS,
  SIDEBAR_LIMITS,
} from './resize.js'

describe('clampWidth', () => {
  it('keeps a width within its limits', () => {
    expect(clampWidth(100, 180, 360)).toBe(180)
    expect(clampWidth(500, 180, 360)).toBe(360)
    expect(clampWidth(250, 180, 360)).toBe(250)
  })
  it('rounds to whole pixels', () => {
    expect(clampWidth(250.6, 180, 360)).toBe(251)
  })
  it('lets the minimum win when the limits cross', () => {
    expect(clampWidth(300, 320, 200)).toBe(320)
  })
})

describe('maxWidth', () => {
  it('is the own maximum when there is room', () => {
    expect(maxWidth(SIDEBAR_LIMITS, 2000)).toBe(SIDEBAR_LIMITS.max)
    expect(maxWidth(PANEL_LIMITS, 2000)).toBe(PANEL_LIMITS.max)
  })
  it('leaves the list its minimum width', () => {
    expect(maxWidth(PANEL_LIMITS, 900)).toBe(900 - LIST_MIN)
  })
  it('never goes below the minimum', () => {
    expect(maxWidth(PANEL_LIMITS, 400)).toBe(PANEL_LIMITS.min)
  })
})

describe('dragWidth', () => {
  it('grows the sidebar when dragged right', () => {
    expect(dragWidth(220, 30, 'right', 180, 360)).toBe(250)
  })
  it('grows the panel when dragged left', () => {
    expect(dragWidth(420, -30, 'left', 320, 640)).toBe(450)
    expect(dragWidth(420, 30, 'left', 320, 640)).toBe(390)
  })
  it('stops at the limits', () => {
    expect(dragWidth(220, -200, 'right', 180, 360)).toBe(180)
    expect(dragWidth(420, -500, 'left', 320, 640)).toBe(640)
  })
})

describe('keyWidth', () => {
  it('moves the edge the way the arrow points', () => {
    expect(keyWidth('ArrowRight', false, 220, 'right', 180, 360)).toBe(220 + KEY_STEP)
    expect(keyWidth('ArrowLeft', false, 220, 'right', 180, 360)).toBe(220 - KEY_STEP)
    expect(keyWidth('ArrowLeft', false, 420, 'left', 320, 640)).toBe(420 + KEY_STEP)
    expect(keyWidth('ArrowRight', false, 420, 'left', 320, 640)).toBe(420 - KEY_STEP)
  })
  it('takes bigger steps with Shift', () => {
    expect(keyWidth('ArrowRight', true, 220, 'right', 180, 360)).toBe(220 + KEY_STEP_LARGE)
  })
  it('stops at the limits', () => {
    expect(keyWidth('ArrowRight', false, 355, 'right', 180, 360)).toBe(360)
    expect(keyWidth('ArrowRight', false, 325, 'left', 320, 640)).toBe(320)
  })
  it('jumps to the ends with Home and End', () => {
    expect(keyWidth('Home', false, 220, 'right', 180, 360)).toBe(180)
    expect(keyWidth('End', false, 220, 'right', 180, 360)).toBe(360)
  })
  it('ignores other keys', () => {
    expect(keyWidth('ArrowUp', false, 220, 'right', 180, 360)).toBeNull()
    expect(keyWidth('Enter', false, 220, 'right', 180, 360)).toBeNull()
  })
})
