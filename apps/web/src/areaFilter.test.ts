import type { Area, CalendarEvent, CalendarInfo, Project, Task } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { areaOfTask, filterAreas, filterByArea, filterEventsByArea } from './areaFilter.js'

const area = (id: string, order: string) => ({ id, title: id, order }) as Area
const project = (id: string, areaId: string | null) => ({ id, areaId }) as Project
const task = (id: string, at: { projectId?: string; areaId?: string }) =>
  ({ id, projectId: at.projectId ?? null, areaId: at.areaId ?? null }) as Task

const projects = [project('p-work', 'work'), project('p-loose', null)]
const ws = {
  projectById: new Map(projects.map((p) => [p.id, p])),
  areaById: new Map(
    [area('home', 'b'), area('work', 'a'), area('idle', 'c')].map((a) => [a.id, a]),
  ),
}
const tasks = [
  task('direct', { areaId: 'work' }),
  task('via-project', { projectId: 'p-work' }),
  task('home', { areaId: 'home' }),
  task('loose-project', { projectId: 'p-loose' }),
  task('inbox', {}),
]

describe('area filter', () => {
  it('finds the area of a task directly or through its project', () => {
    expect(tasks.map((t) => areaOfTask(t, ws))).toEqual(['work', 'work', 'home', null, null])
  })

  it('keeps only the tasks of the area, and everything without a filter', () => {
    expect(filterByArea(tasks, 'work', ws).map((t) => t.id)).toEqual(['direct', 'via-project'])
    expect(filterByArea(tasks, null, ws)).toBe(tasks)
  })

  it('offers the areas in use, in order, plus the active one', () => {
    expect(filterAreas(tasks, [], null, ws).map((a) => a.id)).toEqual(['work', 'home'])
    expect(filterAreas([], [project('x', 'home')], 'idle', ws).map((a) => a.id)).toEqual([
      'home',
      'idle',
    ])
    expect(filterAreas(tasks, [], 'gone', ws).map((a) => a.id)).toEqual(['work', 'home'])
  })

  it('hides only the appointments of a calendar of another area', () => {
    const calendars = [
      { id: 'c-work', areaId: 'work' },
      { id: 'c-home', areaId: 'home' },
      { id: 'c-none', areaId: null },
      { id: 'c-gone', areaId: 'gone' },
    ] as CalendarInfo[]
    const events = calendars.map((c) => ({ id: c.id, calendarId: c.id })) as CalendarEvent[]
    const ids = (area: string | null) =>
      filterEventsByArea(events, calendars, area, ws).map((e) => e.id)
    expect(ids('work')).toEqual(['c-work', 'c-none', 'c-gone'])
    expect(ids(null)).toEqual(['c-work', 'c-home', 'c-none', 'c-gone'])
  })
})
