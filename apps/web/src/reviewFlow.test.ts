import { buildSnapshot, newReview, newTask } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import {
  nextToReview,
  openStepsAfter,
  parseReviewKind,
  reviewBanners,
  showReviewDot,
  stepAfter,
  stepBefore,
  stepStates,
  withDoneStep,
  withoutDoneStep,
} from './reviewFlow.js'

const today = '2026-11-11'
const done = (kind: 'daily' | 'weekly' | 'monthly', on: string) =>
  newReview({ kind, startedAt: `${on}T08:00:00.000Z`, completedAt: `${on}T09:00:00.000Z` })

describe('review dot and banners', () => {
  it('shows nothing when only the daily review is due', () => {
    const reviews = [done('weekly', '2026-11-09'), done('monthly', '2026-11-01')]
    expect(showReviewDot(reviews, today)).toBe(false)
    expect(reviewBanners(reviews, today)).toEqual([])
  })

  it('shows weekly and monthly when they are due, and whether they run', () => {
    const running = newReview({ kind: 'monthly' })
    const reviews = [done('weekly', '2026-11-04'), running]
    expect(showReviewDot(reviews, today)).toBe(true)
    expect(reviewBanners(reviews, today)).toEqual([
      { kind: 'weekly', running: false },
      { kind: 'monthly', running: true },
    ])
  })

  it('is due at once when there never was a review', () => {
    expect(reviewBanners([], today).map((b) => b.kind)).toEqual(['weekly', 'monthly'])
  })
})

describe('steps', () => {
  it('walks the weekly steps in order', () => {
    expect(stepAfter('weekly', 'mindSweep')).toBe('inbox')
    expect(stepAfter('weekly', 'triggers')).toBeNull()
    expect(stepBefore('weekly', 'inbox')).toBe('mindSweep')
    expect(stepBefore('weekly', 'mindSweep')).toBeNull()
    expect(stepAfter('daily', 'inbox')).toBeNull()
  })

  it('reports which steps are done', () => {
    const ws = buildSnapshot(today, {
      tasks: [newTask({ title: 'Loose note' })],
      projects: [],
      areas: [],
      headings: [],
      tags: [],
      checklist: [],
    })
    const review = newReview({ kind: 'weekly', doneSteps: ['mindSweep'] })
    const states = stepStates(review, ws)
    expect(states.map((s) => [s.step.id, s.done]).slice(0, 3)).toEqual([
      ['mindSweep', true],
      ['inbox', false],
      ['weekLookBack', false],
    ])
    // No projects or areas: those steps are done by themselves.
    expect(states.find((s) => s.step.id === 'projects')?.done).toBe(true)
  })

  it('completes only when every step is done, moving on ticks off a once-step', () => {
    const ws = buildSnapshot(today, {
      tasks: [newTask({ title: 'In the Inbox' })],
      projects: [],
      areas: [],
      headings: [],
      tags: [],
      checklist: [],
    })
    const all = ['mindSweep', 'weekLookBack', 'dueSoon', 'looseTasks', 'somedayScan']
    const review = newReview({ kind: 'weekly', doneSteps: all })
    // The Inbox is not empty: it cannot be ticked off, only emptied.
    expect(openStepsAfter(stepStates(review, ws), 'triggers')).toEqual(['inbox'])
    const empty = { ...ws, tasks: [] }
    expect(openStepsAfter(stepStates(review, empty), 'triggers')).toEqual([])
    expect(openStepsAfter(stepStates(review, empty), 'inbox')).toEqual(['triggers'])
    const daily = newReview({ kind: 'daily' })
    expect(openStepsAfter(stepStates(daily, ws), 'inbox')).toEqual(['inbox'])
  })

  it('adds and removes done keys without duplicates', () => {
    const review = newReview({ kind: 'monthly', doneSteps: ['monthLookBack'] })
    expect(withDoneStep(review, 'monthLookBack')).toEqual(['monthLookBack'])
    expect(withDoneStep(review, 'somedayDeep:none')).toEqual(['monthLookBack', 'somedayDeep:none'])
    expect(withoutDoneStep(review, 'monthLookBack')).toEqual([])
  })

  it('parses review kinds from the path', () => {
    expect(parseReviewKind('weekly')).toBe('weekly')
    expect(parseReviewKind('yearly')).toBeNull()
    expect(parseReviewKind(undefined)).toBeNull()
  })
})

describe('nextToReview', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('starts with the first one not done', () => {
    expect(nextToReview(items, (i) => i.id === 'a')?.id).toBe('b')
  })

  it('goes on after the one just ticked off, wrapping around', () => {
    const doneIds = new Set(['d'])
    expect(nextToReview(items, (i) => doneIds.has(i.id), 'c')?.id).toBe('a')
    expect(nextToReview(items, (i) => doneIds.has(i.id), 'a')?.id).toBe('b')
  })

  it('never returns the item just ticked off', () => {
    expect(nextToReview([{ id: 'a' }], () => false, 'a')).toBeNull()
    expect(nextToReview(items, (i) => i.id !== 'b', 'b')).toBeNull()
  })
})
