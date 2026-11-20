import { buildSnapshot, newArea, newProject, reviewQueue } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { groupByReviewDate, selectAfterReviewed } from './reviewList.js'

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

describe('groupByReviewDate', () => {
  it('puts the due items under their review date, earliest first', () => {
    const groups = groupByReviewDate(queue)
    expect(groups.map((g) => g.date)).toEqual(['2026-11-19', today])
    expect(groups[0]?.entries.map((e) => e.item.title)).toEqual(['Home', 'Taxes are filed'])
    expect(groups[1]?.entries.map((e) => e.item.title)).toEqual(['Garden is tidy'])
  })

  it('is empty when nothing is due', () => {
    expect(groupByReviewDate([])).toEqual([])
  })
})

describe('selectAfterReviewed', () => {
  it('moves on to the next item', () => {
    expect(selectAfterReviewed(queue, home.id)).toBe(tax.id)
    expect(selectAfterReviewed(queue, tax.id)).toBe(garden.id)
  })

  it('goes back one from the last item', () => {
    expect(selectAfterReviewed(queue, garden.id)).toBe(tax.id)
  })

  it('selects nothing when the last due item is reviewed', () => {
    expect(selectAfterReviewed(queue.slice(0, 1), home.id)).toBeNull()
  })

  it('starts at the top when the item was not in the queue', () => {
    expect(selectAfterReviewed(queue, later.id)).toBe(home.id)
  })
})
