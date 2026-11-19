import { newTask, type Task } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { newInToday } from './todaySeen.js'

const TODAY = '2026-11-19'

function task(date: string, setOn: string | null, extra: Partial<Task> = {}) {
  return { task: newTask({ title: date, when: { kind: 'date', date }, ...extra }), setOn }
}

function run(items: { task: Task; setOn: string | null }[], seen: string | null) {
  const on = new Map(items.map((x) => [x.task.id, x.setOn]))
  return newInToday(
    items.map((x) => x.task),
    (t) => on.get(t.id) ?? null,
    TODAY,
    seen,
  ).map((t) => t.title)
}

describe('newInToday', () => {
  it('counts a task whose date arrived today and was set earlier', () => {
    expect(run([task(TODAY, '2026-11-10')], null)).toEqual([TODAY])
  })

  it('leaves out what you moved to Today yourself today', () => {
    expect(run([task(TODAY, TODAY)], null)).toEqual([])
  })

  it('leaves out tasks without a known timestamp, later dates and closed tasks', () => {
    expect(
      run(
        [
          task(TODAY, null),
          task('2026-11-20', '2026-11-01'),
          task(TODAY, '2026-11-01', { status: 'completed' }),
        ],
        null,
      ),
    ).toEqual([])
  })

  it('counts every day since the banner was last seen', () => {
    const items = [
      task('2026-11-16', '2026-11-01'),
      task('2026-11-17', '2026-11-01'),
      task(TODAY, '2026-11-01'),
    ]
    expect(run(items, '2026-11-16')).toEqual(['2026-11-17', TODAY])
    expect(run(items, TODAY)).toEqual([])
  })

  it('without a seen day, only counts today', () => {
    expect(run([task('2026-11-18', '2026-11-01'), task(TODAY, '2026-11-01')], null)).toEqual([
      TODAY,
    ])
  })
})
