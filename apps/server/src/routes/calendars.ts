import { AREA_COLORS, daysBetween } from '@dingen/core'
import { Hono } from 'hono'
import { z } from 'zod'
import { FeedError } from '../calendar/ics.js'
import { type CalendarService, InvalidUrlError, MAX_RANGE_DAYS } from '../calendar/service.js'
import type { AppEnv } from '../env.js'

const Color = z.enum(AREA_COLORS).nullable()
const Name = z.string().trim().min(1).max(100)

const AddBody = z.object({
  name: Name,
  url: z.string().min(1).max(4096),
  color: Color.default(null),
})

const PatchBody = z
  .object({ name: Name.optional(), color: Color.optional() })
  .refine((b) => b.name !== undefined || b.color !== undefined)

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const RangeQuery = z
  .object({ from: Day, to: Day })
  .refine((q) => q.from <= q.to && daysBetween(q.from, q.to) < MAX_RANGE_DAYS)

/**
 * Agenda's (alleen lezen). Vereist een ingelogde gebruiker. Antwoorden en
 * fouten bevatten nooit de feed-URL; ook de validatiefouten niet.
 */
export function calendarRoutes(service: CalendarService, timezone: string) {
  const app = new Hono<AppEnv>()

  app.get('/', (c) => c.json({ calendars: service.list(c.get('userId')) }))

  app.post('/', async (c) => {
    const parsed = AddBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
    try {
      const calendar = await service.add(c.get('userId'), parsed.data)
      return c.json({ calendar }, 201)
    } catch (err) {
      if (err instanceof InvalidUrlError) return c.json({ error: 'invalid_url' }, 400)
      if (err instanceof FeedError) return c.json({ error: err.code }, 400)
      throw err
    }
  })

  app.patch('/:id', async (c) => {
    const parsed = PatchBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const calendar = service.update(c.get('userId'), c.req.param('id'), parsed.data)
    return calendar ? c.json({ calendar }) : c.json({ error: 'not_found' }, 404)
  })

  app.delete('/:id', (c) =>
    service.remove(c.get('userId'), c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not_found' }, 404),
  )

  app.get('/events', async (c) => {
    const parsed = RangeQuery.safeParse({ from: c.req.query('from'), to: c.req.query('to') })
    if (!parsed.success) return c.json({ error: 'invalid_range' }, 400)
    return c.json(await service.events(c.get('userId'), { ...parsed.data, timezone }))
  })

  return app
}
