import { buildSnapshot, newArea, newProject, newTask, reviewQueue } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { openCount, reviewAge, selectAfterReviewed } from './reviewList.js'

const today = '2026-11-20'
// Reviewed on these days, every week by default: due a week later.
const at = (date: string) => `${date}T12:00:00.000Z`
const home = newArea({ title: 'Home', order: 'a', reviewedAt: at('2026-11-12') })
const garden = newProject({ title: 'Garden is tidy', areaId: home.id, order: 'a' })
const tax = newProject({
  title: 'Taxes are filed',
  order: 'b',
  reviewedAt: at('2026-11-12'),
})
const later = newProject({ title: 'Not yet', order: 'c', reviewedAt: at('2026-11-18') })

const ws = buildSnapshot(today, {
  areas: [home],
  projects: [garden, tax, later],
  tasks: [],
  headings: [],
  tags: [],
  checklist: [],
})
const queue = reviewQueue(ws, today)

describe('selectAfterReviewed', () => {
  it('keeps sidebar order: projects without an area, then the area and its project', () => {
    expect(queue.map((e) => e.item.title)).toEqual(['Taxes are filed', 'Home', 'Garden is tidy'])
  })

  it('moves on to the next item', () => {
    expect(selectAfterReviewed(queue, tax.id)).toBe(home.id)
    expect(selectAfterReviewed(queue, home.id)).toBe(garden.id)
  })

  it('goes back one from the last item', () => {
    expect(selectAfterReviewed(queue, garden.id)).toBe(home.id)
  })

  it('selects nothing when the last due item is reviewed', () => {
    expect(selectAfterReviewed(queue.slice(0, 1), tax.id)).toBeNull()
  })

  it('starts at the top when the item was not in the queue', () => {
    expect(selectAfterReviewed(queue, later.id)).toBe(tax.id)
  })
})

describe('reviewAge', () => {
  it('is null for an item never reviewed', () => {
    expect(reviewAge(null, today)).toBeNull()
  })

  it('counts days, then weeks, months and years', () => {
    expect(reviewAge(at('2026-11-20'), today)).toEqual({ n: 0, unit: 'day' })
    expect(reviewAge(at('2026-11-15'), today)).toEqual({ n: 5, unit: 'day' })
    expect(reviewAge(at('2026-10-30'), today)).toEqual({ n: 3, unit: 'week' })
    expect(reviewAge(at('2026-08-01'), today)).toEqual({ n: 3, unit: 'month' })
    expect(reviewAge(at('2024-11-01'), today)).toEqual({ n: 2, unit: 'year' })
  })
})

describe('openCount', () => {
  const tasks = [
    newTask({ title: 'a', projectId: garden.id, areaId: home.id }),
    newTask({ title: 'b', projectId: garden.id, status: 'completed' }),
    newTask({ title: 'c', areaId: home.id }),
    newTask({ title: 'd', areaId: home.id, deleted: true }),
  ]
  const entry = (id: string) => {
    const found = queue.find((e) => e.item.id === id)
    if (!found) throw new Error(`not in the queue: ${id}`)
    return found
  }

  it("counts a project's open tasks", () => {
    expect(openCount(entry(garden.id), tasks)).toBe(1)
  })

  it("counts only an area's own open tasks, not its projects'", () => {
    expect(openCount(entry(home.id), tasks)).toBe(1)
  })
})
