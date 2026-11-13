import { describe, expect, it } from 'vitest'
import { buildSnapshot, type Snapshot } from './actions.js'
import { Area, Project, Review, validateChangeFields } from './entities.js'
import { newArea, newProject, newReview, newTask } from './factories.js'
import { createClock } from './hlc.js'
import { ulid } from './ids.js'
import {
  currentStep,
  dueReviews,
  isReviewedIn,
  isStepDone,
  lastCompletedReview,
  nextReviewDate,
  reviewItems,
  reviewSteps,
  runningReview,
  signals,
  somedayGroupKey,
} from './review.js'

const TODAY = '2026-11-11'
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

function done(kind: Review['kind'], date: string): Review {
  return newReview({ kind, startedAt: at(date), createdAt: at(date), completedAt: at(date) })
}

describe('datamodel', () => {
  it('parses projects and areas synced before reviewedAt existed, with null', () => {
    const { reviewedAt: _p, ...oldProject } = newProject({ title: 'p' })
    const { reviewedAt: _a, ...oldArea } = newArea({ title: 'a' })
    expect(Project.parse(oldProject).reviewedAt).toBeNull()
    expect(Area.parse(oldArea).reviewedAt).toBeNull()
  })

  it('newReview starts now, open, without done steps', () => {
    const r = newReview({ kind: 'weekly' })
    expect(Review.parse(r)).toEqual(r)
    expect(r.completedAt).toBeNull()
    expect(r.doneSteps).toEqual([])
    expect(r.startedAt).toBe(r.createdAt)
  })

  it('accepts a new review and a reviewedAt change through server-side validation', () => {
    const clock = createClock('TEST')
    const review = newReview({ kind: 'monthly' })
    const { id, ...fields } = review
    const change = {
      id: ulid(),
      entityType: 'review' as const,
      entityId: id,
      fields,
      ts: clock.now(),
      clientId: 'TEST',
    }
    expect(validateChangeFields(change, undefined)).toEqual({ ok: true })

    const project = newProject({ title: 'p' })
    const touch = {
      ...change,
      id: ulid(),
      entityType: 'project' as const,
      entityId: project.id,
      fields: { reviewedAt: at(TODAY) },
    }
    expect(validateChangeFields(touch, project)).toEqual({ ok: true })
  })

  it('rejects an unknown review kind', () => {
    const { id, ...fields } = newReview({ kind: 'weekly' })
    const change = {
      id: ulid(),
      entityType: 'review' as const,
      entityId: id,
      fields: { ...fields, kind: 'quarterly' },
      ts: createClock('TEST').now(),
      clientId: 'TEST',
    }
    expect(validateChangeFields(change, undefined).ok).toBe(false)
  })
})

describe('dueReviews', () => {
  it('everything is due when there never was a review', () => {
    expect(dueReviews([], TODAY)).toEqual(['daily', 'weekly', 'monthly'])
    expect(nextReviewDate([], 'weekly')).toBeNull()
  })

  it('daily is done for today and due again tomorrow', () => {
    const reviews = [done('daily', TODAY)]
    expect(dueReviews(reviews, TODAY)).not.toContain('daily')
    expect(dueReviews(reviews, '2026-11-12')).toContain('daily')
  })

  it('weekly is due 7 days after the last one', () => {
    const reviews = [done('weekly', '2026-11-04')]
    expect(nextReviewDate(reviews, 'weekly')).toBe('2026-11-11')
    expect(dueReviews(reviews, '2026-11-10')).not.toContain('weekly')
    expect(dueReviews(reviews, '2026-11-11')).toContain('weekly')
    expect(dueReviews(reviews, '2026-11-20')).toContain('weekly')
  })

  it('monthly is due on the same day next month', () => {
    const reviews = [done('monthly', '2026-10-15')]
    expect(dueReviews(reviews, '2026-11-14')).not.toContain('monthly')
    expect(dueReviews(reviews, '2026-11-15')).toContain('monthly')
  })

  it('monthly after 31 January is due on the last day of February', () => {
    const reviews = [done('monthly', '2027-01-31')]
    expect(nextReviewDate(reviews, 'monthly')).toBe('2027-02-28')
    expect(dueReviews(reviews, '2027-02-27')).not.toContain('monthly')
    expect(dueReviews(reviews, '2027-02-28')).toContain('monthly')
    expect(nextReviewDate([done('monthly', '2028-01-31')], 'monthly')).toBe('2028-02-29')
  })

  it('counts from the latest completed review and ignores deleted ones', () => {
    const reviews = [
      done('weekly', '2026-10-01'),
      done('weekly', '2026-11-08'),
      { ...done('weekly', '2026-11-10'), deleted: true },
    ]
    expect(lastCompletedReview(reviews, 'weekly')?.completedAt).toBe(at('2026-11-08'))
    expect(nextReviewDate(reviews, 'weekly')).toBe('2026-11-15')
  })

  it('a running review is always ready, even before its rhythm says so', () => {
    const reviews = [
      done('weekly', '2026-11-09'),
      newReview({ kind: 'weekly', startedAt: at('2026-11-10') }),
    ]
    expect(dueReviews(reviews, TODAY)).toContain('weekly')
  })
})

describe('dueReviews with an account anchor', () => {
  const CREATED = '2026-11-11'

  it('a new account has no weekly or monthly review ready yet; daily is', () => {
    expect(dueReviews([], CREATED, CREATED)).toEqual(['daily'])
    expect(nextReviewDate([], 'daily', CREATED)).toBeNull()
    expect(nextReviewDate([], 'weekly', CREATED)).toBe('2026-11-18')
    expect(nextReviewDate([], 'monthly', CREATED)).toBe('2026-12-11')
  })

  it('the first weekly review is ready 7 days after the account was created', () => {
    expect(dueReviews([], '2026-11-17', CREATED)).not.toContain('weekly')
    expect(dueReviews([], '2026-11-18', CREATED)).toEqual(['daily', 'weekly'])
  })

  it('the first monthly review is ready a month after the account was created', () => {
    expect(dueReviews([], '2026-12-10', CREATED)).not.toContain('monthly')
    expect(dueReviews([], '2026-12-11', CREATED)).toContain('monthly')
    expect(nextReviewDate([], 'monthly', '2027-01-31')).toBe('2027-02-28')
  })

  it('after a completed review the anchor no longer matters', () => {
    const reviews = [done('weekly', '2026-11-13')]
    expect(nextReviewDate(reviews, 'weekly', CREATED)).toBe('2026-11-20')
    expect(dueReviews(reviews, '2026-11-19', CREATED)).not.toContain('weekly')
    expect(dueReviews(reviews, '2026-11-20', CREATED)).toContain('weekly')
    // Monthly was never done: still counted from the anchor.
    expect(nextReviewDate(reviews, 'monthly', CREATED)).toBe('2026-12-11')
  })

  it('a running review is ready even before the anchor says so', () => {
    const reviews = [newReview({ kind: 'monthly', startedAt: at(CREATED) })]
    expect(dueReviews(reviews, CREATED, CREATED)).toContain('monthly')
  })

  it('without an anchor (undefined or null) a never-done review is due at once, as before', () => {
    expect(dueReviews([], CREATED)).toEqual(['daily', 'weekly', 'monthly'])
    expect(dueReviews([], CREATED, null)).toEqual(['daily', 'weekly', 'monthly'])
    expect(nextReviewDate([], 'monthly', null)).toBeNull()
  })

  it('with two running reviews the earliest start wins', () => {
    const late = newReview({ kind: 'weekly', startedAt: at('2026-11-11') })
    const early = newReview({ kind: 'weekly', startedAt: at('2026-11-10') })
    expect(runningReview([late, early], 'weekly')?.id).toBe(early.id)
    expect(runningReview([late, early], 'monthly')).toBeNull()
  })
})

describe('reviewSteps', () => {
  it('daily has only the inbox', () => {
    expect(reviewSteps('daily').map((s) => s.id)).toEqual(['inbox'])
  })
  it('weekly follows the GTD steps of the plan', () => {
    expect(reviewSteps('weekly').map((s) => s.id)).toEqual([
      'mindSweep',
      'inbox',
      'weekLookBack',
      'dueSoon',
      'projects',
      'areas',
      'looseTasks',
      'somedayScan',
      'triggers',
    ])
  })
  it('monthly: look back, areas, someday', () => {
    expect(reviewSteps('monthly').map((s) => s.id)).toEqual([
      'monthLookBack',
      'areasDeep',
      'somedayDeep',
    ])
  })
  it('step ids are unique across kinds where they mean something else', () => {
    const all = (['daily', 'weekly', 'monthly'] as const).flatMap((k) => reviewSteps(k))
    const byId = new Map(all.map((s) => [s.id, s.check]))
    for (const s of all) expect(byId.get(s.id)).toBe(s.check)
  })
})

describe('reviewItems', () => {
  const home = newArea({ title: 'Home', order: 'b' })
  const work = newArea({ title: 'Work', order: 'a' })
  const active = newProject({ title: 'Active', areaId: home.id })
  const loose = newProject({ title: 'No area' })
  const dream = newProject({ title: 'Dream', when: { kind: 'someday' }, areaId: work.id })
  const finished = newProject({
    title: 'Finished',
    areaId: work.id,
    status: 'completed',
    completedAt: at('2026-11-09'),
  })
  const inboxTask = newTask({ title: 'inbox' })
  const looseTask = newTask({ title: 'loose', when: { kind: 'anytime' } })
  const looseSomeday = newTask({ title: 'loose someday', when: { kind: 'someday' } })
  const homeTask = newTask({ title: 'home task', when: { kind: 'anytime' }, areaId: home.id })
  const homeSomeday = newTask({ title: 'home someday', when: { kind: 'someday' }, areaId: home.id })
  const inDream = newTask({ title: 'in dream', when: { kind: 'someday' }, projectId: dream.id })
  const inActiveSomeday = newTask({
    title: 'active someday',
    when: { kind: 'someday' },
    projectId: active.id,
  })
  const overdue = newTask({
    title: 'overdue',
    when: { kind: 'date', date: '2026-11-01' },
    projectId: active.id,
  })
  const inTwoWeeks = newTask({
    title: '14 days',
    deadline: '2026-11-25',
    when: { kind: 'anytime' },
  })
  const inThreeWeeks = newTask({
    title: '21 days',
    when: { kind: 'date', date: '2026-12-02' },
  })
  const doneThisWeek = newTask({
    title: 'done this week',
    status: 'completed',
    completedAt: at('2026-11-05'),
    areaId: home.id,
  })
  const doneLastMonth = newTask({
    title: 'done last month',
    status: 'completed',
    completedAt: at('2026-10-20'),
    projectId: active.id,
  })
  const doneLongAgo = newTask({
    title: 'done long ago',
    status: 'completed',
    completedAt: at('2026-09-01'),
  })
  const template = newTask({
    title: 'template',
    when: { kind: 'anytime' },
    repeat: {
      unit: 'day',
      every: 1,
      basis: 'schedule',
      weekdays: [],
      start: TODAY,
      until: null,
      deadlineDays: 0,
    },
  })
  const inFinished = newTask({
    title: 'in finished',
    when: { kind: 'anytime' },
    projectId: finished.id,
  })

  const ws = snap({
    areas: [home, work],
    projects: [active, loose, dream, finished],
    tasks: [
      inboxTask,
      looseTask,
      looseSomeday,
      homeTask,
      homeSomeday,
      inDream,
      inActiveSomeday,
      overdue,
      inTwoWeeks,
      inThreeWeeks,
      doneThisWeek,
      doneLastMonth,
      doneLongAgo,
      template,
      inFinished,
    ],
  })
  const titles = (items: { title: string }[]) => items.map((i) => i.title)

  it('inbox', () => {
    const items = reviewItems('inbox', ws, TODAY)
    expect(items.kind === 'tasks' && titles(items.tasks)).toEqual(['inbox'])
  })

  it('weekly look back: last 7 days, tasks and projects, counted per area', () => {
    const items = reviewItems('weekLookBack', ws, TODAY)
    if (items.kind !== 'logbook') throw new Error(items.kind)
    expect(titles(items.tasks)).toEqual(['done this week'])
    expect(titles(items.projects)).toEqual(['Finished'])
    expect(items.perArea).toEqual([
      { areaId: work.id, count: 1 },
      { areaId: home.id, count: 1 },
    ])
  })

  it('monthly look back: one month back, task area via its project', () => {
    const items = reviewItems('monthLookBack', ws, TODAY)
    if (items.kind !== 'logbook') throw new Error(items.kind)
    expect(titles(items.tasks)).toEqual(['done this week', 'done last month'])
    expect(items.perArea).toEqual([
      { areaId: work.id, count: 1 },
      { areaId: home.id, count: 2 },
    ])
  })

  it('overdue and upcoming: past dates and the next 14 days, earliest first', () => {
    const items = reviewItems('dueSoon', ws, TODAY)
    if (items.kind !== 'dated') throw new Error(items.kind)
    expect(titles(items.tasks)).toEqual(['overdue', '14 days'])
  })

  it('projects: open and not Someday, by area order with no area first', () => {
    const items = reviewItems('projects', ws, TODAY)
    expect(items.kind === 'projects' && titles(items.projects)).toEqual(['No area', 'Active'])
  })

  it('areas: open loose tasks and open projects per area', () => {
    const items = reviewItems('areas', ws, TODAY)
    if (items.kind !== 'areas') throw new Error(items.kind)
    expect(items.areas.map((a) => a.area.title)).toEqual(['Work', 'Home'])
    const homeItem = items.areas[1]
    expect(titles(homeItem?.tasks ?? []).sort()).toEqual(['home someday', 'home task'])
    expect(titles(homeItem?.projects ?? [])).toEqual(['Active'])
    expect(titles(items.areas[0]?.projects ?? [])).toEqual(['Dream'])
  })

  it('loose tasks: no project, no area, not Inbox or Someday, no templates', () => {
    const items = reviewItems('looseTasks', ws, TODAY)
    expect(items.kind === 'tasks' && titles(items.tasks).sort()).toEqual([
      '14 days',
      '21 days',
      'loose',
    ])
  })

  it('someday scan: Someday projects, and Someday tasks outside them', () => {
    const items = reviewItems('somedayScan', ws, TODAY)
    if (items.kind !== 'someday') throw new Error(items.kind)
    expect(titles(items.projects)).toEqual(['Dream'])
    expect(titles(items.tasks).sort()).toEqual(['active someday', 'home someday', 'loose someday'])
  })

  it('someday deep: Someday tasks grouped by area, via the project when needed', () => {
    const items = reviewItems('somedayDeep', ws, TODAY)
    if (items.kind !== 'somedayGroups') throw new Error(items.kind)
    expect(titles(items.projects)).toEqual(['Dream'])
    expect(items.groups.map((g) => [g.areaId, titles(g.tasks).sort()])).toEqual([
      [null, ['loose someday']],
      [home.id, ['active someday', 'home someday']],
    ])
  })

  it('steps without a list', () => {
    expect(reviewItems('mindSweep', ws, TODAY)).toEqual({ kind: 'none' })
    expect(reviewItems('triggers', ws, TODAY)).toEqual({ kind: 'none' })
  })

  it('tasks of a closed project and completed tasks stay out of every list', () => {
    for (const step of ['inbox', 'dueSoon', 'looseTasks', 'somedayScan'] as const) {
      const items = reviewItems(step, ws, TODAY)
      const tasks = 'tasks' in items ? items.tasks : []
      expect(titles(tasks)).not.toContain('in finished')
      expect(titles(tasks)).not.toContain('done this week')
      expect(titles(tasks)).not.toContain('template')
    }
  })
})

describe('progress within a review', () => {
  const start = at('2026-11-11')
  const review = newReview({ kind: 'weekly', startedAt: start })

  it('reviewedAt counts from the start of the review', () => {
    const p = newProject({ title: 'p' })
    expect(isReviewedIn(p, review)).toBe(false)
    expect(isReviewedIn({ ...p, reviewedAt: at('2026-11-04') }, review)).toBe(false)
    expect(isReviewedIn({ ...p, reviewedAt: start }, review)).toBe(true)
    const utc = newReview({ kind: 'weekly', startedAt: '2026-11-11T11:00:00.000Z' })
    expect(isReviewedIn({ ...p, reviewedAt: '2026-11-11T12:00:00.000+01:00' }, utc)).toBe(true)
    expect(isReviewedIn({ ...p, reviewedAt: '2026-11-11T11:59:00.000+01:00' }, utc)).toBe(false)
  })

  it('the inbox step is done while the Inbox is empty', () => {
    const step = { id: 'inbox', check: 'inboxEmpty' } as const
    expect(isStepDone(review, step, snap({}), TODAY)).toBe(true)
    expect(isStepDone(review, step, snap({ tasks: [newTask({ title: 'x' })] }), TODAY)).toBe(false)
  })

  it('a once step is done when ticked', () => {
    const step = { id: 'mindSweep', check: 'once' } as const
    expect(isStepDone(review, step, snap({}), TODAY)).toBe(false)
    expect(isStepDone({ ...review, doneSteps: ['mindSweep'] }, step, snap({}), TODAY)).toBe(true)
  })

  it('the projects step is done when every listed project is reviewed in this review', () => {
    const step = { id: 'projects', check: 'perItem' } as const
    const a = newProject({ title: 'a' })
    const b = newProject({ title: 'b', reviewedAt: at(TODAY) })
    const someday = newProject({ title: 's', when: { kind: 'someday' } })
    expect(isStepDone(review, step, snap({ projects: [a, b, someday] }), TODAY)).toBe(false)
    const handled = { ...a, status: 'completed' as const, completedAt: at(TODAY) }
    expect(isStepDone(review, step, snap({ projects: [handled, b, someday] }), TODAY)).toBe(true)
    expect(isStepDone(review, step, snap({ projects: [] }), TODAY)).toBe(true)
    expect(
      isStepDone({ ...review, doneSteps: ['projects'] }, step, snap({ projects: [a] }), TODAY),
    ).toBe(true)
  })

  it('the monthly someday step needs the projects and every group', () => {
    const monthly = newReview({ kind: 'monthly', startedAt: start })
    const step = { id: 'somedayDeep', check: 'perItem' } as const
    const area = newArea({ title: 'a' })
    const p = newProject({ title: 'p', when: { kind: 'someday' }, reviewedAt: at(TODAY) })
    const t = newTask({ title: 't', when: { kind: 'someday' }, areaId: area.id })
    const u = newTask({ title: 'u', when: { kind: 'someday' } })
    const ws = snap({ areas: [area], projects: [p], tasks: [t, u] })
    expect(isStepDone(monthly, step, ws, TODAY)).toBe(false)
    const one = { ...monthly, doneSteps: [somedayGroupKey(area.id)] }
    expect(isStepDone(one, step, ws, TODAY)).toBe(false)
    const both = { ...monthly, doneSteps: [somedayGroupKey(area.id), somedayGroupKey(null)] }
    expect(isStepDone(both, step, ws, TODAY)).toBe(true)
  })

  it('currentStep is the first step not done; null when all are', () => {
    const ws = snap({ tasks: [newTask({ title: 'in inbox' })] })
    expect(currentStep(review, ws, TODAY)?.id).toBe('mindSweep')
    expect(currentStep({ ...review, doneSteps: ['mindSweep'] }, ws, TODAY)?.id).toBe('inbox')
    const daily = newReview({ kind: 'daily', startedAt: start })
    expect(currentStep(daily, snap({}), TODAY)).toBeNull()
  })
})

describe('signals', () => {
  const recent = at('2026-11-10')

  it('a fresh project with an available task has none', () => {
    const p = newProject({ title: 'p', createdAt: recent })
    const t = newTask({ title: 't', when: { kind: 'anytime' }, projectId: p.id, createdAt: recent })
    expect(signals(p, snap({ projects: [p], tasks: [t] }), TODAY)).toEqual([])
  })

  describe('noNextAction', () => {
    const p = newProject({ title: 'p', createdAt: recent })
    const task = (fields: Parameters<typeof newTask>[0]) =>
      newTask({ projectId: p.id, createdAt: recent, ...fields })

    it('without tasks', () => {
      expect(signals(p, snap({ projects: [p] }), TODAY)).toEqual(['noNextAction'])
    })
    it('with only future, Someday or completed tasks', () => {
      const tasks = [
        task({ title: 'later', when: { kind: 'date', date: '2026-12-01' } }),
        task({ title: 'someday', when: { kind: 'someday' } }),
        task({ title: 'done', status: 'completed', completedAt: recent }),
      ]
      expect(signals(p, snap({ projects: [p], tasks }), TODAY)).toEqual(['noNextAction'])
    })
    it('a task for today or overdue counts as a next action', () => {
      const tasks = [task({ title: 'overdue', when: { kind: 'date', date: '2026-11-01' } })]
      expect(signals(p, snap({ projects: [p], tasks }), TODAY)).toEqual([])
    })
    it('not for a Someday project', () => {
      const s = { ...p, when: { kind: 'someday' as const } }
      expect(signals(s, snap({ projects: [s] }), TODAY)).not.toContain('noNextAction')
    })
    it('a closed or deleted project has no signals at all', () => {
      const closed = { ...p, status: 'completed' as const, completedAt: recent }
      expect(signals(closed, snap({ projects: [closed] }), TODAY)).toEqual([])
      expect(signals({ ...p, deleted: true }, snap({}), TODAY)).toEqual([])
    })
  })

  describe('deadlineSoon', () => {
    const p = newProject({ title: 'p', createdAt: recent })
    const next = newTask({
      title: 'next',
      when: { kind: 'anytime' },
      projectId: p.id,
      createdAt: recent,
    })
    const ws = (project: Project, extra: ReturnType<typeof newTask>[] = []) =>
      snap({ projects: [project], tasks: [next, ...extra] })

    it('project deadline within 14 days, on day 14, or passed', () => {
      expect(signals({ ...p, deadline: '2026-11-25' }, ws(p), TODAY)).toEqual(['deadlineSoon'])
      expect(signals({ ...p, deadline: '2026-10-01' }, ws(p), TODAY)).toEqual(['deadlineSoon'])
      expect(signals({ ...p, deadline: '2026-11-26' }, ws(p), TODAY)).toEqual([])
    })
    it('deadline of an open task in the project', () => {
      const t = newTask({ title: 't', deadline: '2026-11-20', projectId: p.id, createdAt: recent })
      expect(signals(p, ws(p, [t]), TODAY)).toEqual(['deadlineSoon'])
      const closed = { ...t, status: 'completed' as const, completedAt: recent }
      expect(signals(p, ws(p, [closed]), TODAY)).toEqual([])
    })
    it('area: its own tasks, its projects and their tasks', () => {
      const area = newArea({ title: 'a', createdAt: recent })
      const inArea = { ...p, areaId: area.id }
      const direct = newTask({
        title: 'd',
        areaId: area.id,
        deadline: '2026-11-12',
        createdAt: recent,
      })
      expect(signals(area, snap({ areas: [area], tasks: [direct] }), TODAY)).toEqual([
        'deadlineSoon',
      ])
      const viaProject = newTask({
        title: 'v',
        projectId: p.id,
        deadline: '2026-11-12',
        createdAt: recent,
      })
      expect(
        signals(area, snap({ areas: [area], projects: [inArea], tasks: [viaProject] }), TODAY),
      ).toEqual(['deadlineSoon'])
      const projectDeadline = { ...inArea, deadline: '2026-11-12' }
      expect(signals(area, snap({ areas: [area], projects: [projectDeadline] }), TODAY)).toEqual([
        'deadlineSoon',
      ])
      expect(signals(area, snap({ areas: [area], projects: [inArea] }), TODAY)).toEqual([])
    })
  })

  describe('longQuiet and notReviewedLately', () => {
    const old = at('2026-09-01')

    it('28 days without activity; reviewing does not count, completing does', () => {
      const p = newProject({ title: 'p', createdAt: old, reviewedAt: recent })
      const t = newTask({ title: 't', when: { kind: 'anytime' }, projectId: p.id, createdAt: old })
      expect(signals(p, snap({ projects: [p], tasks: [t] }), TODAY)).toEqual(['longQuiet'])
      const doneLately = newTask({
        title: 'd',
        projectId: p.id,
        createdAt: old,
        status: 'completed',
        completedAt: at('2026-11-01'),
      })
      expect(signals(p, snap({ projects: [p], tasks: [t, doneLately] }), TODAY)).toEqual([])
    })

    it('exactly 28 days is quiet, 27 is not', () => {
      const area = (createdAt: string) => newArea({ title: 'a', createdAt, reviewedAt: recent })
      const a28 = area(at('2026-10-14'))
      const a27 = area(at('2026-10-15'))
      expect(signals(a28, snap({ areas: [a28] }), TODAY)).toEqual(['longQuiet'])
      expect(signals(a27, snap({ areas: [a27] }), TODAY)).toEqual([])
    })

    it('area activity includes a project completed in it', () => {
      const a = newArea({ title: 'a', createdAt: old, reviewedAt: recent })
      const p = newProject({
        title: 'p',
        areaId: a.id,
        createdAt: old,
        status: 'completed',
        completedAt: recent,
      })
      expect(signals(a, snap({ areas: [a], projects: [p] }), TODAY)).toEqual([])
    })

    it('not reviewed for 14 days; never reviewed counts from creation', () => {
      const a = (fields: Partial<Area>) =>
        newArea({ title: 'a', createdAt: at('2026-11-01'), ...fields })
      const never = a({})
      expect(signals(never, snap({}), TODAY)).toEqual([])
      const fresh = a({ createdAt: at('2026-10-28') })
      expect(signals(fresh, snap({}), TODAY)).toEqual(['notReviewedLately'])
      expect(signals(a({ reviewedAt: at('2026-10-28') }), snap({}), TODAY)).toEqual([
        'notReviewedLately',
      ])
      expect(signals(a({ reviewedAt: at('2026-10-29') }), snap({}), TODAY)).toEqual([])
    })
  })
})
