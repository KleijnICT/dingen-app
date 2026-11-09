import { describe, expect, it } from 'vitest'
import { newTask } from './factories.js'
import { orderBetween } from './order.js'
import * as views from './views.js'

const TODAY = '2026-11-09'

describe('views', () => {
  const inbox = newTask({ title: 'inbox' })
  const todayTask = newTask({ title: 'vandaag', when: { kind: 'date', date: TODAY } })
  const overdue = newTask({ title: 'gisteren', when: { kind: 'date', date: '2026-11-01' } })
  const future = newTask({ title: 'morgen', when: { kind: 'date', date: '2026-11-10' } })
  const later = newTask({ title: 'later', when: { kind: 'date', date: '2026-12-01' } })
  const anytime = newTask({ title: 'anytime', when: { kind: 'anytime' } })
  const someday = newTask({ title: 'ooit', when: { kind: 'someday' } })
  const done = newTask({
    title: 'klaar',
    status: 'completed',
    completedAt: '2026-11-08T10:00:00.000Z',
  })
  const doneLater = newTask({
    title: 'klaar2',
    status: 'canceled',
    completedAt: '2026-11-09T10:00:00.000Z',
  })
  const deleted = newTask({ title: 'weg', deleted: true })
  const all = [inbox, todayTask, overdue, future, later, anytime, someday, done, doneLater, deleted]

  it('Inbox', () => {
    expect(views.inbox(all).map((t) => t.title)).toEqual(['inbox'])
  })
  it('Vandaag bevat ook verlopen datums', () => {
    expect(
      views
        .today(all, TODAY)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['gisteren', 'vandaag'])
  })
  it('Binnenkort op datum', () => {
    expect(views.upcoming(all, TODAY).map((t) => t.title)).toEqual(['morgen', 'later'])
  })
  it('Anytime bevat Vandaag maar niet Inbox of Ooit', () => {
    expect(
      views
        .anytime(all, TODAY)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['anytime', 'gisteren', 'vandaag'])
  })
  it('Ooit', () => {
    expect(views.someday(all).map((t) => t.title)).toEqual(['ooit'])
  })
  it('Logboek nieuwste eerst, zonder verwijderde', () => {
    expect(views.logbook(all).map((t) => t.title)).toEqual(['klaar2', 'klaar'])
  })
  it('sorteert op order', () => {
    const a = newTask({ title: 'a', when: { kind: 'anytime' } })
    const b = newTask({ title: 'b', when: { kind: 'anytime' }, order: orderBetween(a.order, null) })
    const c = newTask({
      title: 'c',
      when: { kind: 'anytime' },
      order: orderBetween(a.order, b.order),
    })
    expect(views.anytime([b, c, a], TODAY).map((t) => t.title)).toEqual(['a', 'c', 'b'])
  })
})
