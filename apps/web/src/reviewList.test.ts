import { buildSnapshot, newArea, newProject, reviewQueue } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { selectAfterReviewed } from './reviewList.js'

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
