import { newHeading, newProject, newTask, views } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { completedSection, onSomeday, projectSections, splitSomeday } from './sections.js'

const project = newProject({ title: 'Verhuizen' })
const first = newHeading({ title: 'Inpakken', projectId: project.id, order: 'a' })
const second = newHeading({ title: 'Uitpakken', projectId: project.id, order: 'b' })

const done = (title: string, headingId: string | null, completedAt: string) =>
  newTask({ title, projectId: project.id, headingId, status: 'completed', completedAt })

const loose = newTask({ title: 'Busje huren', projectId: project.id, order: 'a' })
const box = newTask({ title: 'Dozen halen', projectId: project.id, headingId: first.id })
const kitchen = newTask({ title: 'Keuken', projectId: project.id, headingId: second.id })
const tape = done('Tape kopen', first.id, '2026-11-10T09:00:00.000Z')
const lamp = done('Lamp ophangen', second.id, '2026-11-12T09:00:00.000Z')
const keys = done('Sleutels', null, '2026-11-11T09:00:00.000Z')

const all = [loose, box, kitchen, tape, lamp, keys]
const open = [loose, box, kitchen]

describe('projectSections', () => {
  it('keeps completed tasks out of every heading, newest first', () => {
    const s = projectSections(all, open, [first, second])
    expect(s.loose.map((t) => t.title)).toEqual(['Busje huren'])
    expect(s.headings.map((h) => [h.heading.title, h.tasks.map((t) => t.title)])).toEqual([
      ['Inpakken', ['Dozen halen']],
      ['Uitpakken', ['Keuken']],
    ])
    expect(s.completed.map((t) => t.title)).toEqual(['Lamp ophangen', 'Sleutels', 'Tape kopen'])
  })

  it('leaves a task that was just ticked off in place while it lingers', () => {
    const s = projectSections(all, [...open, lamp], [first, second])
    expect(s.headings[1]?.tasks.map((t) => t.title)).toEqual(['Keuken', 'Lamp ophangen'])
    expect(s.completed.map((t) => t.title)).toEqual(['Sleutels', 'Tape kopen'])
  })

  it('filters only the open groups and puts tasks of a missing heading at the top', () => {
    const tagged = newTask({ title: 'Getagd', projectId: project.id, tagIds: ['x'] })
    const orphan = newTask({
      title: 'Wees',
      projectId: project.id,
      headingId: 'gone',
      tagIds: ['x'],
    })
    const s = projectSections([...all, tagged, orphan], [...open, tagged, orphan], [first], (t) =>
      t.tagIds.includes('x'),
    )
    expect(s.loose.map((t) => t.title)).toEqual(['Getagd', 'Wees'])
    expect(s.headings[0]?.tasks).toEqual([])
    expect(s.completed).toHaveLength(3)
  })
})

describe('the Someday section', () => {
  const someday = { kind: 'someday' } as const
  const later = newTask({ title: 'Later', projectId: project.id, when: someday, order: 'c' })
  const dream = newTask({
    title: 'Droom',
    projectId: project.id,
    headingId: second.id,
    when: someday,
    order: 'b',
  })

  it('takes Someday tasks out of the loose tasks and the headings, in their own order', () => {
    const s = projectSections([...all, later, dream], [...open, later, dream], [first, second])
    expect(s.loose.map((t) => t.title)).toEqual(['Busje huren'])
    expect(s.headings.map((h) => h.tasks.map((t) => t.title))).toEqual([
      ['Dozen halen'],
      ['Keuken'],
    ])
    expect(s.someday.map((t) => t.title)).toEqual(['Later', 'Droom'])
    expect(s.completed).toHaveLength(3)
  })

  it('keeps a Someday task that was just ticked off in the section while it lingers', () => {
    const ticked = { ...dream, status: 'completed' as const, completedAt: '2026-11-20T09:00:00Z' }
    const s = projectSections([...all, ticked], [...open, ticked], [first, second])
    expect(s.someday.map((t) => t.title)).toEqual(['Droom'])
    expect(s.headings[1]?.tasks.map((t) => t.title)).toEqual(['Keuken'])
  })

  it('applies the tag filter to the Someday section too', () => {
    const s = projectSections([...all, later], [...open, later], [first], (t) =>
      t.tagIds.includes('x'),
    )
    expect(s.someday).toEqual([])
  })

  it('splits tasks and projects into regular and Someday, keeping the order', () => {
    const plan = newProject({ title: 'Plan', order: 'a' })
    const wish = newProject({ title: 'Wens', when: someday, order: 'b' })
    const next = newProject({ title: 'Volgende', order: 'c' })
    const split = splitSomeday([plan, wish, next])
    expect(split.regular.map((p) => p.title)).toEqual(['Plan', 'Volgende'])
    expect(split.someday.map((p) => p.title)).toEqual(['Wens'])
    expect(splitSomeday([loose, later]).someday).toEqual([later])
  })

  it('agrees with views.isSomeday for open items', () => {
    for (const item of [loose, later, dream, newProject({ title: 'p', when: someday })]) {
      expect(onSomeday(item)).toBe(views.isSomeday(item))
    }
    expect(onSomeday({ ...later, deleted: true })).toBe(false)
  })
})

describe('completedSection', () => {
  it('counts canceled tasks as completed too', () => {
    const canceled = newTask({ title: 'Afgezegd', status: 'canceled', completedAt: '2026-11-13' })
    expect(completedSection([loose, canceled], [loose]).map((t) => t.title)).toEqual(['Afgezegd'])
  })
})
