import type { Snapshot } from './actions.js'
import { addDays, addMonths, daysBetween, toCalendarDate } from './dates.js'
import type { Area, CalendarDate, Project, Review, ReviewKind, Task } from './entities.js'
import * as views from './views.js'

/**
 * The reviews (docs/10-review-plan.md) as pure functions: when a review is
 * due, its steps, what each step shows, and the signals on a project or area.
 * Web, server and MCP share them, so a review means the same everywhere.
 */

/** Fixed thresholds in days; no settings. */
export const REVIEW_THRESHOLDS = {
  /** Upcoming window of the "overdue and upcoming" step and of "deadline soon". */
  soonDays: 14,
  /** No activity for this many days: "long quiet". */
  quietDays: 28,
  /** Not reviewed for this many days: "not reviewed lately" (one weekly review skipped). */
  notReviewedDays: 14,
  /** The weekly review is due this many days after the last one. */
  weeklyDays: 7,
} as const

// --- When a review is due ---

/** The calendar date of an instant, in the caller's time zone. */
export function dateOf(iso: string): CalendarDate {
  return toCalendarDate(new Date(iso))
}

function liveOfKind(reviews: Review[], kind: ReviewKind): Review[] {
  return reviews.filter((r) => !r.deleted && r.kind === kind)
}

/**
 * The running review of a kind, or null. Should two devices each have started
 * one, the earliest start wins (then the id), so everyone picks the same one.
 */
export function runningReview(reviews: Review[], kind: ReviewKind): Review | null {
  const running = liveOfKind(reviews, kind)
    .filter((r) => r.completedAt === null)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id))
  return running[0] ?? null
}

/** The most recently completed review of a kind, or null. */
export function lastCompletedReview(reviews: Review[], kind: ReviewKind): Review | null {
  let last: Review | null = null
  for (const r of liveOfKind(reviews, kind)) {
    if (r.completedAt === null) continue
    if (last === null || Date.parse(r.completedAt) > Date.parse(last.completedAt as string))
      last = r
  }
  return last
}

/**
 * The date from which a review of this kind is due; null when there never was
 * one (then it is due at once). Daily: the day after the last one; weekly:
 * 7 days after; monthly: the same day next month (31 Jan → 28 Feb).
 */
export function nextReviewDate(reviews: Review[], kind: ReviewKind): CalendarDate | null {
  const last = lastCompletedReview(reviews, kind)
  if (last === null || last.completedAt === null) return null
  const done = dateOf(last.completedAt)
  if (kind === 'daily') return addDays(done, 1)
  if (kind === 'weekly') return addDays(done, REVIEW_THRESHOLDS.weeklyDays)
  return addMonths(done, 1)
}

const KINDS: ReviewKind[] = ['daily', 'weekly', 'monthly']

/** Kinds that are ready today: due by their rhythm, or still running. */
export function dueReviews(reviews: Review[], today: CalendarDate): ReviewKind[] {
  return KINDS.filter((kind) => {
    if (runningReview(reviews, kind) !== null) return true
    const next = nextReviewDate(reviews, kind)
    return next === null || next <= today
  })
}

// --- Steps ---

export type ReviewStepId =
  | 'mindSweep'
  | 'inbox'
  | 'weekLookBack'
  | 'dueSoon'
  | 'projects'
  | 'areas'
  | 'looseTasks'
  | 'somedayScan'
  | 'triggers'
  | 'monthLookBack'
  | 'areasDeep'
  | 'somedayDeep'

/**
 * How a step gets done:
 * - `inboxEmpty`: done while the Inbox is empty;
 * - `once`: one tick for the whole step (its id in `doneSteps`);
 * - `perItem`: done when every item is ticked off (or the step id is in `doneSteps`).
 */
export type StepCheck = 'inboxEmpty' | 'once' | 'perItem'

export interface ReviewStep {
  id: ReviewStepId
  check: StepCheck
}

const STEPS: Record<ReviewKind, ReviewStep[]> = {
  daily: [{ id: 'inbox', check: 'inboxEmpty' }],
  weekly: [
    { id: 'mindSweep', check: 'once' },
    { id: 'inbox', check: 'inboxEmpty' },
    { id: 'weekLookBack', check: 'once' },
    { id: 'dueSoon', check: 'once' },
    { id: 'projects', check: 'perItem' },
    { id: 'areas', check: 'perItem' },
    { id: 'looseTasks', check: 'once' },
    { id: 'somedayScan', check: 'once' },
    { id: 'triggers', check: 'once' },
  ],
  monthly: [
    { id: 'monthLookBack', check: 'once' },
    { id: 'areasDeep', check: 'perItem' },
    { id: 'somedayDeep', check: 'perItem' },
  ],
}

export function reviewSteps(kind: ReviewKind): ReviewStep[] {
  return STEPS[kind]
}

// --- Items per step ---

export interface AreaCount {
  areaId: string | null
  count: number
}

export interface AreaGroup {
  areaId: string | null
  tasks: Task[]
}

export interface AreaItem {
  area: Area
  /** Open tasks directly in the area, not via a project. */
  tasks: Task[]
  /** Open projects in the area (Someday included). */
  projects: Project[]
}

export type ReviewItems =
  | { kind: 'none' }
  | { kind: 'tasks'; tasks: Task[] }
  | { kind: 'logbook'; tasks: Task[]; projects: Project[]; perArea: AreaCount[] }
  | { kind: 'dated'; tasks: Task[]; projects: Project[] }
  | { kind: 'projects'; projects: Project[] }
  | { kind: 'areas'; areas: AreaItem[] }
  | { kind: 'someday'; tasks: Task[]; projects: Project[] }
  | { kind: 'somedayGroups'; projects: Project[]; groups: AreaGroup[] }

/** Tasks the lists can show: not deleted, no templates, not in a closed project. */
function liveTasks(ws: Snapshot): Task[] {
  return views.available(
    ws.tasks.filter((t) => !t.deleted && t.repeat === null),
    ws.projects,
  )
}

function liveProjects(ws: Snapshot): Project[] {
  return ws.projects.filter((p) => !p.deleted)
}

/** The area of a task: its own, or that of its project. */
function areaOfTask(task: Task, projectById: Map<string, Project>): string | null {
  if (task.projectId !== null) return projectById.get(task.projectId)?.areaId ?? null
  return task.areaId
}

/** Orders area ids by area order, with "no area" first. */
function byAreaOrder(areas: Area[]): (a: string | null, b: string | null) => number {
  const rank = new Map(views.openAreas(areas).map((a, i) => [a.id, i]))
  const r = (id: string | null) => (id === null ? -1 : (rank.get(id) ?? Number.MAX_SAFE_INTEGER))
  return (a, b) => r(a) - r(b)
}

function logbookSince(ws: Snapshot, from: CalendarDate, today: CalendarDate): ReviewItems {
  const inRange = (i: Task | Project) =>
    views.isLogbook(i) &&
    i.completedAt !== null &&
    dateOf(i.completedAt) >= from &&
    dateOf(i.completedAt) <= today
  const tasks = ws.tasks.filter((t) => t.repeat === null && inRange(t)).sort(views.byCompletedDesc)
  const projects = ws.projects.filter(inRange).sort(views.byCompletedDesc)
  const projectById = new Map(ws.projects.map((p) => [p.id, p]))
  const counts = new Map<string | null, number>()
  const add = (areaId: string | null) => counts.set(areaId, (counts.get(areaId) ?? 0) + 1)
  for (const t of tasks) add(areaOfTask(t, projectById))
  for (const p of projects) add(p.areaId)
  const order = byAreaOrder(ws.areas)
  const perArea = [...counts.entries()]
    .map(([areaId, count]) => ({ areaId, count }))
    .sort((a, b) => order(a.areaId, b.areaId))
  return { kind: 'logbook', tasks, projects, perArea }
}

/** Earliest date that puts an item in the "overdue and upcoming" step, or null. */
function datedKey(item: Task | Project, until: CalendarDate): CalendarDate | null {
  const dates: CalendarDate[] = []
  if (item.when.kind === 'date') dates.push(item.when.date)
  if (item.deadline !== null) dates.push(item.deadline)
  const first = dates.sort()[0]
  return first !== undefined && first <= until ? first : null
}

function dated(ws: Snapshot, today: CalendarDate): ReviewItems {
  const until = addDays(today, REVIEW_THRESHOLDS.soonDays)
  const pick = <T extends Task | Project>(items: T[]): T[] =>
    items
      .filter((i) => views.isOpen(i) && datedKey(i, until) !== null)
      .sort(
        (a, b) =>
          (datedKey(a, until) as string).localeCompare(datedKey(b, until) as string) ||
          views.byOrder(a, b),
      )
  return { kind: 'dated', tasks: pick(liveTasks(ws)), projects: pick(liveProjects(ws)) }
}

/** Open projects not on Someday, grouped by area (no area first), then by order. */
function activeProjects(ws: Snapshot): Project[] {
  const order = byAreaOrder(ws.areas)
  return liveProjects(ws)
    .filter((p) => views.isOpen(p) && !views.isSomeday(p))
    .sort((a, b) => order(a.areaId, b.areaId) || views.byOrder(a, b))
}

function areaItems(ws: Snapshot): AreaItem[] {
  const tasks = liveTasks(ws)
  return views.openAreas(ws.areas).map((area) => ({
    area,
    tasks: views.areaTasks(tasks, area.id).filter(views.isOpen),
    projects: views.projectsOf(liveProjects(ws), area.id),
  }))
}

/** Someday tasks outside Someday projects (those come along with their project). */
function somedayTasks(ws: Snapshot): Task[] {
  return views.someday(views.notInSomedayProject(liveTasks(ws), ws.projects))
}

function somedayProjects(ws: Snapshot): Project[] {
  return liveProjects(ws).filter(views.isSomeday).sort(views.byOrder)
}

function somedayGroups(ws: Snapshot): AreaGroup[] {
  const projectById = new Map(ws.projects.map((p) => [p.id, p]))
  const groups = new Map<string | null, Task[]>()
  for (const t of somedayTasks(ws)) {
    const areaId = areaOfTask(t, projectById)
    groups.set(areaId, [...(groups.get(areaId) ?? []), t])
  }
  const order = byAreaOrder(ws.areas)
  return [...groups.entries()]
    .map(([areaId, tasks]) => ({ areaId, tasks }))
    .sort((a, b) => order(a.areaId, b.areaId))
}

/** What a step shows. Steps without a list (mind sweep, triggers) give `none`. */
export function reviewItems(step: ReviewStepId, ws: Snapshot, today: CalendarDate): ReviewItems {
  switch (step) {
    case 'inbox':
      return { kind: 'tasks', tasks: views.inbox(liveTasks(ws)) }
    case 'weekLookBack':
      return logbookSince(ws, addDays(today, -REVIEW_THRESHOLDS.weeklyDays), today)
    case 'monthLookBack':
      return logbookSince(ws, addMonths(today, -1), today)
    case 'dueSoon':
      return dated(ws, today)
    case 'projects':
      return { kind: 'projects', projects: activeProjects(ws) }
    case 'areas':
    case 'areasDeep':
      return { kind: 'areas', areas: areaItems(ws) }
    case 'looseTasks':
      return {
        kind: 'tasks',
        tasks: liveTasks(ws)
          .filter(
            (t) =>
              views.isOpen(t) &&
              t.projectId === null &&
              t.areaId === null &&
              t.when.kind !== 'inbox' &&
              t.when.kind !== 'someday',
          )
          .sort(views.byOrder),
      }
    case 'somedayScan':
      return { kind: 'someday', tasks: somedayTasks(ws), projects: somedayProjects(ws) }
    case 'somedayDeep':
      return { kind: 'somedayGroups', projects: somedayProjects(ws), groups: somedayGroups(ws) }
    case 'mindSweep':
    case 'triggers':
      return { kind: 'none' }
  }
}

// --- Progress within a review ---

/** Reviewed in this review: `reviewedAt` at or after the review's start. */
export function isReviewedIn(item: Project | Area, review: Review): boolean {
  return item.reviewedAt !== null && Date.parse(item.reviewedAt) >= Date.parse(review.startedAt)
}

/** The `doneSteps` key of a Someday group in the monthly review. */
export function somedayGroupKey(areaId: string | null): string {
  return `somedayDeep:${areaId ?? 'none'}`
}

export function isStepDone(
  review: Review,
  step: ReviewStep,
  ws: Snapshot,
  today: CalendarDate,
): boolean {
  if (step.check === 'inboxEmpty') {
    const items = reviewItems('inbox', ws, today)
    return items.kind === 'tasks' && items.tasks.length === 0
  }
  if (review.doneSteps.includes(step.id)) return true
  if (step.check === 'once') return false
  const items = reviewItems(step.id, ws, today)
  if (items.kind === 'projects') return items.projects.every((p) => isReviewedIn(p, review))
  if (items.kind === 'areas') return items.areas.every((a) => isReviewedIn(a.area, review))
  if (items.kind === 'somedayGroups') {
    return (
      items.projects.every((p) => isReviewedIn(p, review)) &&
      items.groups.every((g) => review.doneSteps.includes(somedayGroupKey(g.areaId)))
    )
  }
  return false
}

/** The first step not yet done, or null when all are. */
export function currentStep(review: Review, ws: Snapshot, today: CalendarDate): ReviewStep | null {
  return reviewSteps(review.kind).find((s) => !isStepDone(review, s, ws, today)) ?? null
}

// --- Signals ---

export type Signal = 'noNextAction' | 'deadlineSoon' | 'longQuiet' | 'notReviewedLately'

function isProject(item: Project | Area): item is Project {
  return 'status' in item
}

/** Tasks of a project, including closed ones; no templates. */
function tasksOfProject(ws: Snapshot, projectId: string): Task[] {
  return ws.tasks.filter((t) => !t.deleted && t.repeat === null && t.projectId === projectId)
}

/** Latest of createdAt and completedAt; `reviewedAt` does not count as activity. */
function lastActivity(items: (Task | Project | Area)[]): string {
  let last = ''
  let lastMs = Number.NEGATIVE_INFINITY
  for (const i of items) {
    for (const iso of [i.createdAt, 'completedAt' in i ? i.completedAt : null]) {
      if (iso === null) continue
      const ms = Date.parse(iso)
      if (ms > lastMs) {
        lastMs = ms
        last = iso
      }
    }
  }
  return last
}

/**
 * Signals on a project or area, with fixed thresholds. A closed or deleted
 * project gets none.
 * - noNextAction (project): open, not Someday, no open task available now.
 * - deadlineSoon: a deadline of the project or of an open task in it (for an
 *   area: of its open projects and their tasks, and its own tasks) within
 *   14 days, or passed.
 * - longQuiet: 28 days without activity (createdAt/completedAt of the item and
 *   everything in it).
 * - notReviewedLately: not reviewed in the last 14 days, counted from
 *   `reviewedAt`, or from `createdAt` if it was never reviewed.
 */
export function signals(item: Project | Area, ws: Snapshot, today: CalendarDate): Signal[] {
  if (item.deleted) return []
  const soon = addDays(today, REVIEW_THRESHOLDS.soonDays)
  const deadlineSoon = (i: Task | Project) =>
    views.isOpen(i) && i.deadline !== null && i.deadline <= soon

  let inside: (Task | Project)[]
  const result: Signal[] = []
  if (isProject(item)) {
    if (!views.isOpen(item)) return []
    inside = tasksOfProject(ws, item.id)
    const hasNext = inside.some((t) => views.isAnytime(t, today))
    if (!views.isSomeday(item) && !hasNext) result.push('noNextAction')
  } else {
    const projects = liveProjects(ws).filter((p) => p.areaId === item.id)
    const direct = ws.tasks.filter(
      (t) => !t.deleted && t.repeat === null && t.projectId === null && t.areaId === item.id,
    )
    inside = [
      ...direct,
      ...projects,
      ...projects.flatMap((p) => (views.isOpen(p) ? tasksOfProject(ws, p.id) : [])),
    ]
  }

  if ((isProject(item) && deadlineSoon(item)) || inside.some(deadlineSoon)) {
    result.push('deadlineSoon')
  }
  const last = lastActivity([item, ...inside])
  if (daysBetween(dateOf(last), today) >= REVIEW_THRESHOLDS.quietDays) result.push('longQuiet')
  const reviewed = item.reviewedAt ?? item.createdAt
  if (daysBetween(dateOf(reviewed), today) >= REVIEW_THRESHOLDS.notReviewedDays) {
    result.push('notReviewedLately')
  }
  return result
}
