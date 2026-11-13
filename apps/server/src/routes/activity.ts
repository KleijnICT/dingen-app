import { ACTIVITY_KINDS, type ActorId, isActorId } from '@dingen/core'
import { Hono } from 'hono'
import { z } from 'zod'
import { type ActivityService, MAX_LIMIT } from '../activity/service.js'
import type { AppEnv } from '../env.js'

const Instant = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'An ISO date or date-time')
  .optional()

const ActivityQuery = z.object({
  kinds: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.enum(ACTIVITY_KINDS))),
  actor: z
    .string()
    .optional()
    .refine((s) => s === undefined || isActorId(s), 'A member id or system'),
  since: Instant,
  until: Instant,
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
})

/** `GET /api/activity`: the Logbook lines, newest first, paged on `seq`. */
export function activityRoutes(activity: ActivityService) {
  const app = new Hono<AppEnv>()

  app.get('/', (c) => {
    const parsed = ActivityQuery.safeParse(c.req.query())
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400)
    }
    const q = parsed.data
    const page = activity.list(
      c.get('userId'),
      {
        kinds: q.kinds,
        actor: q.actor as ActorId | undefined,
        since: q.since,
        until: q.until,
        before: q.before,
        limit: q.limit,
      },
      c.get('grants'),
    )
    return c.json(page)
  })

  return app
}
