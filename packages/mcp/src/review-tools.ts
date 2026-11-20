import {
  type Area,
  type Project,
  ReviewEvery,
  reviewEveryOf,
  reviewQueue,
  type Snapshot,
  type Task,
  views,
} from '@dingen/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { DingenClient } from './client.js'

/**
 * The review tools. All meaning comes from `@dingen/core/review`: every
 * project and area has a review frequency, `review_queue` lists what is due
 * and `mark_reviewed` sets `reviewedAt`, the same as the Review page in the app.
 */

export type Run = <T>(
  fn: (ws: Snapshot) => T | Promise<T>,
) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>

export interface ReviewToolDeps {
  run: Run
  fail: (message: string) => never
  findProject: (ws: Snapshot, ref: string) => Project
  findArea: (ws: Snapshot, ref: string) => Area
  taskRow: (ws: Snapshot, t: Task) => Record<string, unknown>
}

/** The `reviewEvery` input of update_project, create_area and update_area. */
export const ReviewEveryInput = ReviewEvery.nullable().describe(
  "How often it comes up for review: { n, unit } with unit 'day', 'week', 'month' or 'year' (for example { n: 2, unit: 'week' }), or null for the default, every week",
)

export function registerReviewTools(
  server: McpServer,
  client: DingenClient,
  deps: ReviewToolDeps,
): void {
  const { run, fail } = deps

  /** An open task, briefly. */
  const brief = (ws: Snapshot, t: Task) => {
    const row = deps.taskRow(ws, t)
    return {
      id: row.id,
      title: row.title,
      when: row.when,
      ...(row.deadline ? { deadline: row.deadline } : {}),
      ...(row.heading ? { heading: row.heading } : {}),
    }
  }

  server.registerTool(
    'review_queue',
    {
      title: 'What is due for review',
      description:
        'The projects and areas that are due for review today, earliest first. Every project and every area has a review frequency (default: every week); once that time has passed since it was last marked reviewed, it is due. Someday projects are included; completed and cancelled ones are not. For each: kind, id, title, area (for projects), nextReviewOn, reviewEvery and its open tasks (an area: its loose tasks, without those of its projects). Walk through them one by one with the user: look at each, make the changes it needs, then call mark_reviewed. Change a frequency with update_project or update_area.',
      inputSchema: {},
    },
    () =>
      run((ws) => {
        const queue = reviewQueue(ws, ws.today)
        return {
          today: ws.today,
          due: queue.length,
          items: queue.map((entry) => {
            const { item } = entry
            const base = {
              kind: entry.kind,
              id: item.id,
              title: item.title,
              nextReviewOn: entry.nextReviewOn,
              reviewEvery: reviewEveryOf(item),
              reviewedAt: item.reviewedAt,
            }
            if (entry.kind === 'area') {
              const tasks = views.areaTasks(ws.tasks, entry.item.id).filter(views.isOpen)
              return { ...base, openTasks: tasks.map((t) => brief(ws, t)) }
            }
            const area = entry.item.areaId
              ? ws.areas.find((a) => a.id === entry.item.areaId)
              : undefined
            const tasks = views.projectTasks(ws.tasks, entry.item.id).filter(views.isOpen)
            return {
              ...base,
              ...(entry.item.status === 'open' && entry.item.when.kind === 'someday'
                ? { someday: true }
                : {}),
              ...(area ? { area: area.title } : {}),
              openTasks: tasks.map((t) => brief(ws, t)),
            }
          }),
        }
      }),
  )

  server.registerTool(
    'mark_reviewed',
    {
      title: 'Mark a project or area as reviewed',
      description:
        'Marks one project or area as reviewed (sets its reviewedAt to now), as the "Reviewed" button in the app does. It then leaves review_queue and comes back one review frequency from today. Do this after the user has looked at it and any changes are made. Pass exactly one of `project` or `area`.',
      inputSchema: {
        project: z.string().optional().describe('Id or exact title (case-insensitive)'),
        area: z.string().optional().describe('Id or exact title (case-insensitive)'),
      },
    },
    ({ project, area }) =>
      run((ws) => {
        if ((project === undefined) === (area === undefined))
          fail('Pass exactly one of project or area')
        const at = new Date().toISOString()
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
}

/** An area with its review fields; used by the overview and the area tools. */
export function areaRow(_ws: Snapshot, a: Area) {
  return {
    id: a.id,
    title: a.title,
    icon: a.icon,
    color: a.color,
    reviewEvery: reviewEveryOf(a),
    reviewedAt: a.reviewedAt,
  }
}
