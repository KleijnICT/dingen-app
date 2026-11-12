import {
  type Area,
  currentStep,
  dueReviews,
  isReviewedIn,
  isStepDone,
  newReview,
  nextReviewDate,
  type Project,
  type Review,
  type ReviewItems,
  ReviewKind,
  type ReviewStepId,
  reviewItems,
  reviewSteps,
  runningReview,
  type Snapshot,
  signals,
  somedayGroupKey,
  type Task,
} from '@dingen/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { DingenClient } from './client.js'

/**
 * The review tools. All meaning comes from
 * `@dingen/core/review`: the same steps, items and signals as the app, and the
 * progress lives in the synced `review` entity and in `reviewedAt`, so a
 * review started with Claude can be finished in the app and the other way round.
 */

export type Run = <T>(
  fn: (ws: Snapshot) => T | Promise<T>,
) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>

export interface ReviewToolDeps {
  run: Run
  fail: (message: string) => never
  findProject: (ws: Snapshot, ref: string) => Project
  findArea: (ws: Snapshot, ref: string) => Area
  projectRow: (ws: Snapshot, p: Project) => Record<string, unknown>
  taskRow: (ws: Snapshot, t: Task) => Record<string, unknown>
}

const KIND_DESCRIPTION =
  "'daily' (Inbox empty), 'weekly' (the full GTD weekly review) or 'monthly' (areas and Someday in depth)"

export function registerReviewTools(
  server: McpServer,
  client: DingenClient,
  deps: ReviewToolDeps,
): void {
  const { run, fail } = deps
  const reviews = () => client.entities<Review>('review')
  const now = () => new Date().toISOString()

  const requireRunning = (kind: ReviewKind): Review => {
    const review = runningReview(reviews(), kind)
    if (review === null) fail(`No ${kind} review is running; call start_review first`)
    return review as Review
  }

  const reviewState = (ws: Snapshot, review: Review, withItems: boolean) => {
    const current = currentStep(review, ws, ws.today)
    return {
      id: review.id,
      kind: review.kind,
      startedAt: review.startedAt,
      steps: reviewSteps(review.kind).map((s) => ({
        id: s.id,
        check: s.check,
        done: isStepDone(review, s, ws, ws.today),
      })),
      currentStep: current?.id ?? null,
      ...(withItems && current
        ? { items: describeItems(ws, review, reviewItems(current.id, ws, ws.today), deps) }
        : {}),
    }
  }

  server.registerTool(
    'get_review',
    {
      title: 'Get the reviews',
      description:
        'Which reviews are due today, and for each running review its steps (done or not) and the current step. With `kind`, also the items of the current step (or of `step`) with their signals and whether each was reviewed in this review. Read this before and after every review action; it is the same progress the app shows.',
      inputSchema: {
        kind: ReviewKind.optional().describe(KIND_DESCRIPTION),
        step: z
          .string()
          .optional()
          .describe('A step id of that kind, to see its items instead of the current step'),
      },
    },
    ({ kind, step }) =>
      run((ws) => {
        const all = reviews()
        const kinds = ReviewKind.options.filter((k) => kind === undefined || k === kind)
        return {
          today: ws.today,
          due: dueReviews(all, ws.today),
          reviews: kinds.map((k) => {
            const review = runningReview(all, k)
            const base = { kind: k, nextDue: nextReviewDate(all, k) ?? ws.today }
            if (review === null) {
              if (step !== undefined) fail(`No ${k} review is running; call start_review first`)
              return { ...base, running: null }
            }
            const state = reviewState(ws, review, kind !== undefined && step === undefined)
            if (step === undefined) return { ...base, running: state }
            const stepId = stepOf(review.kind, step, fail)
            return {
              ...base,
              running: {
                ...state,
                items: describeItems(ws, review, reviewItems(stepId, ws, ws.today), deps),
              },
            }
          }),
        }
      }),
  )

  server.registerTool(
    'start_review',
    {
      title: 'Start or resume a review',
      description:
        'Starts a review of this kind, or resumes the one already running (also when it was started in the app). Returns its steps and the items of the current step. Starting is allowed when the review is not due yet.',
      inputSchema: { kind: ReviewKind.describe(KIND_DESCRIPTION) },
    },
    ({ kind }) =>
      run((ws) => {
        let review = runningReview(reviews(), kind)
        const resumed = review !== null
        if (review === null) {
          review = newReview({ kind })
          client.create('review', review)
        }
        return { resumed, ...reviewState(ws, review, true) }
      }),
  )

  server.registerTool(
    'mark_reviewed',
    {
      title: 'Mark a project or area as reviewed',
      description:
        'Ticks off one project or area in the running review (sets its reviewedAt to now), as the "Reviewed" button in the app does. Do this after the user has looked at it and any changes are made. Pass exactly one of `project` or `area`.',
      inputSchema: {
        project: z.string().optional().describe('Id or exact title (case-insensitive)'),
        area: z.string().optional().describe('Id or exact title (case-insensitive)'),
      },
    },
    ({ project, area }) =>
      run((ws) => {
        if ((project === undefined) === (area === undefined))
          fail('Pass exactly one of project or area')
        const at = now()
        if (project !== undefined) {
          const p = deps.findProject(ws, project)
          client.mutate('project', p.id, { reviewedAt: at })
          return { reviewed: { project: p.id, title: p.title }, reviewedAt: at }
        }
        const a = deps.findArea(ws, area as string)
        client.mutate('area', a.id, { reviewedAt: at })
        return { reviewed: { area: a.id, title: a.title }, reviewedAt: at }
      }),
  )

  server.registerTool(
    'complete_review_step',
    {
      title: 'Complete a review step',
      description:
        "Ticks off a step of the running review. Steps checked 'once' (mind sweep, look back, due soon, loose tasks, Someday scan, triggers) are ticked as a whole. The Inbox step cannot be ticked: it is done when the Inbox is empty. Steps checked 'perItem' (projects, areas) are done by mark_reviewed on every item; ticking one here skips the items not yet reviewed, so only do that when the user says so. For the monthly 'somedayDeep' step pass `group` (an area id, or 'none') to tick one group of Someday tasks.",
      inputSchema: {
        kind: ReviewKind.describe(KIND_DESCRIPTION),
        step: z.string().describe('A step id from get_review'),
        group: z
          .string()
          .optional()
          .describe("somedayDeep only: the area id of a Someday group, or 'none'"),
      },
    },
    ({ kind, step, group }) =>
      run((ws) => {
        const review = requireRunning(kind)
        const stepId = stepOf(kind, step, fail)
        const def = reviewSteps(kind).find((s) => s.id === stepId)
        if (def?.check === 'inboxEmpty') {
          fail('The Inbox step is done when the Inbox is empty; process the Inbox first')
        }
        let key: string = stepId
        if (group !== undefined) {
          if (stepId !== 'somedayDeep') fail('`group` only applies to the somedayDeep step')
          const items = reviewItems('somedayDeep', ws, ws.today)
          const groups = items.kind === 'somedayGroups' ? items.groups : []
          const areaId = group === 'none' ? null : group
          if (!groups.some((g) => g.areaId === areaId)) fail(`No Someday group "${group}"`)
          key = somedayGroupKey(areaId)
        }
        const updated: Review = review.doneSteps.includes(key)
          ? review
          : { ...review, doneSteps: [...review.doneSteps, key] }
        if (updated !== review) {
          client.mutate('review', review.id, { doneSteps: updated.doneSteps })
        }
        return { ticked: key, ...reviewState(ws, updated, true) }
      }),
  )

  server.registerTool(
    'complete_review',
    {
      title: 'Complete a review',
      description:
        'Finishes the running review of this kind; the next one becomes due by its rhythm (daily: tomorrow, weekly: in 7 days, monthly: same day next month). Refused while steps are open, unless `force` is true. Only call this after the user agrees the review is done.',
      inputSchema: {
        kind: ReviewKind.describe(KIND_DESCRIPTION),
        force: z.boolean().default(false).describe('Complete even with open steps'),
      },
    },
    ({ kind, force }) =>
      run((ws) => {
        const review = requireRunning(kind)
        const open = reviewSteps(kind)
          .filter((s) => !isStepDone(review, s, ws, ws.today))
          .map((s) => s.id)
        if (open.length > 0 && !force) {
          fail(`Steps still open: ${open.join(', ')}. Finish them or pass force: true`)
        }
        const completedAt = now()
        client.mutate('review', review.id, { completedAt })
        const after = [...reviews().filter((r) => r.id !== review.id), { ...review, completedAt }]
        return {
          completed: review.id,
          kind,
          completedAt,
          skippedSteps: open,
          nextDue: nextReviewDate(after, kind),
        }
      }),
  )
}

function stepOf(kind: ReviewKind, step: string, fail: (m: string) => never): ReviewStepId {
  const steps = reviewSteps(kind)
  const found = steps.find((s) => s.id === step)
  if (!found) {
    fail(`No step "${step}" in the ${kind} review; steps: ${steps.map((s) => s.id).join(', ')}`)
  }
  return (found as { id: ReviewStepId }).id
}

/** The items of a step for Claude: rows as elsewhere, plus review state and signals. */
function describeItems(ws: Snapshot, review: Review, items: ReviewItems, deps: ReviewToolDeps) {
  const project = (p: Project) => ({
    ...deps.projectRow(ws, p),
    reviewed: isReviewedIn(p, review),
  })
  const areaTitle = (id: string | null) =>
    id === null ? null : (ws.areas.find((a) => a.id === id)?.title ?? id)
  const tasks = (list: Task[]) => list.map((t) => deps.taskRow(ws, t))
  switch (items.kind) {
    case 'none':
      return { kind: 'none' }
    case 'tasks':
      return { kind: 'tasks', tasks: tasks(items.tasks) }
    case 'logbook':
      return {
        kind: 'logbook',
        perArea: items.perArea.map((c) => ({ area: areaTitle(c.areaId), count: c.count })),
        projects: items.projects.map((p) => ({ id: p.id, title: p.title })),
        tasks: tasks(items.tasks),
      }
    case 'dated':
      return { kind: 'dated', projects: items.projects.map(project), tasks: tasks(items.tasks) }
    case 'projects':
      return { kind: 'projects', projects: items.projects.map(project) }
    case 'areas':
      return {
        kind: 'areas',
        areas: items.areas.map((i) => ({
          ...areaRow(ws, i.area),
          reviewed: isReviewedIn(i.area, review),
          tasks: tasks(i.tasks),
          projects: i.projects.map((p) => p.title),
        })),
      }
    case 'someday':
      return { kind: 'someday', projects: items.projects.map(project), tasks: tasks(items.tasks) }
    case 'somedayGroups':
      return {
        kind: 'somedayGroups',
        projects: items.projects.map(project),
        groups: items.groups.map((g) => ({
          group: g.areaId ?? 'none',
          area: areaTitle(g.areaId),
          done: review.doneSteps.includes(somedayGroupKey(g.areaId)),
          tasks: tasks(g.tasks),
        })),
      }
  }
}

/** An area with its review fields; used by the overview and the review tools. */
export function areaRow(ws: Snapshot, a: Area) {
  return {
    id: a.id,
    title: a.title,
    icon: a.icon,
    color: a.color,
    reviewedAt: a.reviewedAt,
    signals: signals(a, ws, ws.today),
  }
}
