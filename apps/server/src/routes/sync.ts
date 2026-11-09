import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.js'
import { PushBody, SyncValidationError } from '../sync.js'

const PullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
})

/** Sync-API. Vereist een ingelogde gebruiker (`userId` in de context). */
export function syncRoutes() {
  const app = new Hono<AppEnv>()

  app.post('/push', async (c) => {
    const parsed = PushBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    }
    try {
      const result = c.get('sync').push(c.get('userId'), parsed.data.changes)
      return c.json(result)
    } catch (err) {
      if (err instanceof SyncValidationError) {
        return c.json({ error: 'invalid_changes', problems: err.problems }, 400)
      }
      throw err
    }
  })

  app.get('/pull', (c) => {
    const parsed = PullQuery.safeParse(c.req.query())
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400)
    }
    return c.json(c.get('sync').pull(c.get('userId'), parsed.data.since))
  })

  app.get('/snapshot', (c) => {
    return c.json(c.get('sync').snapshot(c.get('userId')))
  })

  return app
}
