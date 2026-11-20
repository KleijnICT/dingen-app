import { type Area, newArea, newProject } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { LIST_MIN, maxWidth, SIDEBAR_LIMITS } from './resize.js'
import { railAreaActive, railEntries, sidebarRoom, sidebarShape } from './sidebarFold.js'

const base = { narrow: false, reviewing: false, collapsed: false, reviewOpen: false }

describe('sidebarShape', () => {
  it('is a drawer on phones, whatever was chosen', () => {
    expect(sidebarShape({ ...base, narrow: true, collapsed: true })).toBe('drawer')
    expect(sidebarShape({ ...base, narrow: true, reviewing: true })).toBe('drawer')
  })

  it("follows the user's choice outside the review", () => {
    expect(sidebarShape(base)).toBe('full')
    expect(sidebarShape({ ...base, collapsed: true })).toBe('rail')
  })

  it('folds in the review unless unfolded there', () => {
    expect(sidebarShape({ ...base, reviewing: true })).toBe('rail')
    expect(sidebarShape({ ...base, reviewing: true, collapsed: true })).toBe('rail')
    expect(sidebarShape({ ...base, reviewing: true, reviewOpen: true })).toBe('full')
    expect(sidebarShape({ ...base, reviewing: true, reviewOpen: true, collapsed: true })).toBe(
      'full',
    )
  })

  it('ignores an unfolded review once the review is left', () => {
    expect(sidebarShape({ ...base, collapsed: true, reviewOpen: true })).toBe('rail')
  })
})

describe('railEntries', () => {
  it('shows the lists, Review before the Logbook, then the open areas only', () => {
    const work = newArea({ title: 'Work', order: 'b' })
    const home = newArea({ title: 'Home', order: 'a' })
    const gone: Area = { ...newArea({ title: 'Gone', order: 'c' }), deleted: true }
    const entries = railEntries([work, gone, home])
    expect(
      entries.map((e) => (e.kind === 'list' ? e.id : e.kind === 'area' ? e.area.title : e.kind)),
    ).toEqual([
      'inbox',
      'today',
      'upcoming',
      'anytime',
      'someday',
      'review',
      'logbook',
      'Home',
      'Work',
    ])
  })
})

describe('railAreaActive', () => {
  const area = newArea({ title: 'Work', order: 'a' })
  const inArea = newProject({ title: 'Ship', areaId: area.id, order: 'a' })
  const loose = newProject({ title: 'Loose', areaId: null, order: 'b' })
  const projects = new Map([
    [inArea.id, inArea],
    [loose.id, loose],
  ])

  it('lights the area on its own page and on its projects', () => {
    expect(railAreaActive(area.id, { kind: 'area', id: area.id }, projects)).toBe(true)
    expect(railAreaActive(area.id, { kind: 'project', id: inArea.id }, projects)).toBe(true)
  })

  it('stays dark elsewhere', () => {
    expect(railAreaActive(area.id, { kind: 'project', id: loose.id }, projects)).toBe(false)
    expect(railAreaActive(area.id, { kind: 'area', id: 'other' }, projects)).toBe(false)
    expect(railAreaActive(area.id, { kind: 'list' }, projects)).toBe(false)
  })
})

describe('sidebarRoom', () => {
  const room = { window: 1400, panel: 400, rail: 56 }

  it('is the window less the panel for the full sidebar', () => {
    expect(sidebarRoom({ ...room, shape: 'full', reviewing: false })).toBe(1000)
  })

  it('leaves out the rail when the handle sizes the review list beside it', () => {
    expect(sidebarRoom({ ...room, shape: 'rail', reviewing: true })).toBe(944)
  })

  it('shares the room when sidebar and review list grow together', () => {
    const r = sidebarRoom({ ...room, shape: 'full', reviewing: true })
    const w = maxWidth(SIDEBAR_LIMITS, r)
    // Sidebar and review list, both this wide, still leave the list its minimum.
    expect(2 * w).toBeLessThanOrEqual(room.window - room.panel - LIST_MIN)
    expect(w).toBe(320)
  })
})
