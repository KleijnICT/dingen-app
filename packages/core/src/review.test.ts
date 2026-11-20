import { describe, expect, it } from 'vitest'
import { buildSnapshot, type Snapshot } from './actions.js'
import { Area, Project, validateChangeFields } from './entities.js'
import { newArea, newProject } from './factories.js'
import { createClock } from './hlc.js'
import { ulid } from './ids.js'
import { addReviewEvery, isDueForReview, nextReviewOn, reviewQueue } from './review.js'

const TODAY = '2026-11-20'
/** Local noon of a date as an instant, so the tests pass in every time zone. */
const at = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 12).toISOString()
}

function snap(e: Partial<Parameters<typeof buildSnapshot>[1]>, today = TODAY): Snapshot {
  return buildSnapshot(today, {
    tasks: [],
    projects: [],
    areas: [],
    headings: [],
    tags: [],
    checklist: [],
    ...e,
  })
}

describe('datamodel', () => {
  it('parses projects and areas synced before reviewEvery existed, with null', () => {
    const { reviewEvery: _p, reviewedAt: _q, ...oldProject } = newProject({ title: 'p' })
    const { reviewEvery: _a, reviewedAt: _b, ...oldArea } = newArea({ title: 'a' })
    expect(Project.parse(oldProject).reviewEvery).toBeNull()
    expect(Area.parse(oldArea).reviewEvery).toBeNull()
    expect(Project.parse(oldProject).reviewedAt).toBeNull()
  })

  it('accepts reviewedAt and reviewEvery changes and rejects a bad frequency', () => {
    const clock = createClock('TEST')
    const project = newProject({ title: 'p' })
    const change = (fields: Record<string, unknown>) => ({
      id: ulid(),
      entityType: 'project' as const,
      entityId: project.id,
      fields,
      ts: clock.now(),
      clientId: 'TEST',
    })
    expect(validateChangeFields(change({ reviewedAt: at(TODAY) }), project)).toEqual({ ok: true })
    expect(validateChangeFields(change({ reviewEvery: { n: 2, unit: 'month' } }), project)).toEqual(
      { ok: true },
    )
    expect(validateChangeFields(change({ reviewEvery: null }), project)).toEqual({ ok: true })
    expect(validateChangeFields(change({ reviewEvery: { n: 0, unit: 'week' } }), project).ok).toBe(
      false,
    )
    expect(
      validateChangeFields(change({ reviewEvery: { n: 1, unit: 'fortnight' } }), project).ok,
    ).toBe(false)
  })
})

describe('frequency', () => {
  it('adds days, weeks, months and years', () => {
    expect(addReviewEvery('2026-11-20', { n: 3, unit: 'day' })).toBe('2026-11-23')
    expect(addReviewEvery('2026-11-20', { n: 2, unit: 'week' })).toBe('2026-12-04')
    expect(addReviewEvery('2026-01-31', { n: 1, unit: 'month' })).toBe('2026-02-28')
    expect(addReviewEvery('2026-11-20', { n: 1, unit: 'year' })).toBe('2027-11-20')
  })

  it('is due at once when never reviewed', () => {
    const p = newProject({ title: 'p' })
    expect(nextReviewOn(p, TODAY)).toBe(TODAY)
    expect(isDueForReview(p, TODAY)).toBe(true)
  })

  it('defaults to every week after the last review', () => {
    const p = newProject({ title: 'p', reviewedAt: at('2026-11-14') })
    expect(nextReviewOn(p, TODAY)).toBe('2026-11-21')
    expect(isDueForReview(p, TODAY)).toBe(false)
    expect(isDueForReview(p, '2026-11-21')).toBe(true)
  })

  it('uses the item’s own frequency', () => {
    const a = newArea({
      title: 'a',
      reviewedAt: at('2026-10-20'),
      reviewEvery: { n: 1, unit: 'month' },
    })
    expect(nextReviewOn(a, TODAY)).toBe('2026-11-20')
    expect(isDueForReview(a, TODAY)).toBe(true)
  })

  it('skips completed, cancelled and deleted items, but not Someday projects', () => {
    expect(isDueForReview(newProject({ title: 'c', status: 'completed' }), TODAY)).toBe(false)
    expect(isDueForReview(newProject({ title: 'x', status: 'cancelled' }), TODAY)).toBe(false)
    expect(isDueForReview(newProject({ title: 'd', deleted: true }), TODAY)).toBe(false)
    expect(isDueForReview(newArea({ title: 'd', deleted: true }), TODAY)).toBe(false)
    expect(isDueForReview(newProject({ title: 's', when: { kind: 'someday' } }), TODAY)).toBe(true)
  })
})

describe('reviewQueue', () => {
  it('lists due items in sidebar order, whatever day they came due', () => {
    // Home came due before Bath and Site, Site came due today: sidebar order all the same.
    const home = newArea({ title: 'Home', order: 'a1', reviewedAt: at('2026-11-10') })
    const work = newArea({ title: 'Work', order: 'a2', reviewedAt: at('2026-11-19') })
    const bath = newProject({
      title: 'Bath',
      areaId: home.id,
      order: 'a1',
      reviewedAt: at('2026-11-13'),
    })
    const site = newProject({
      title: 'Site',
      areaId: work.id,
      order: 'a1',
      reviewedAt: at('2026-11-01'),
    })
    const loose = newProject({ title: 'Loose', areaId: null, order: 'a1' })
    const later = newProject({
      title: 'Later',
      areaId: work.id,
      order: 'a2',
      reviewedAt: at('2026-11-01'),
      reviewEvery: { n: 1, unit: 'month' },
    })
    const queue = reviewQueue(
      snap({ areas: [work, home], projects: [loose, site, later, bath] }),
      TODAY,
    )
    expect(queue.map((e) => [e.item.title, e.nextReviewOn])).toEqual([
      ['Loose', '2026-11-20'],
      ['Home', '2026-11-17'],
      ['Bath', '2026-11-20'],
      ['Site', '2026-11-08'],
    ])
    expect(queue.map((e) => e.kind)).toEqual(['project', 'area', 'project', 'project'])
  })
})
