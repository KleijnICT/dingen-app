import { parseCursorParam } from '@dingen/core'
import { Hono } from 'hono'
import { z } from 'zod'
import { AgentScopeError } from '../agents/access.js'
import { accessOf } from '../auth/middleware.js'
import type { AppEnv } from '../env.js'
import { SpaceAccessError } from '../spaces/service.js'
import { normalizePushedTag, PushBody, SyncValidationError } from '../sync.js'

const PullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
})

/**
 * Sync-API. Vereist een ingelogde gebruiker (`userId` in de context); agents
 * only with an `all` grant (see app.ts), and their writes are still checked.
 *
 * Pull speaks two protocols (see `SYNC_PROTOCOL` in core):
 * - 2: `GET /pull?cursor=<url-encoded JSON {"<spaceId>": seq}>` answers per
 *   space (`PullResponse`). A bare number as cursor moves a protocol 1 cursor.
 * - 1: `GET /pull?since=<seq>` answers `{ changes, seq, hasMore }` over all
 *   spaces, for clients from before protocol 2. It can go once no released
 *   client sends it (web app and MCP plugin from 1.0.0-alpha.4 and older).
 */
export function syncRoutes() {
  const app = new Hono<AppEnv>()

  app.post('/push', async (c) => {
    const parsed = PushBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    }
    try {
      const result = c
        .get('sync')
        .push(c.get('userId'), parsed.data.changes.map(normalizePushedTag), {
          access: accessOf(c),
          members: c.get('agents').memberGrants(c.get('userId')),
          cursor: parsed.data.cursor,
        })
      return c.json(result)
    } catch (err) {
      if (err instanceof AgentScopeError) {
        return c.json({ error: 'agent_scope', message: err.message }, 403)
      }
      if (err instanceof SpaceAccessError) {
        return c.json({ error: 'space_access', message: err.message }, 403)
      }
      if (err instanceof SyncValidationError) {
        return c.json({ error: 'invalid_changes', problems: err.problems }, 400)
      }
      throw err
    }
  })

  app.get('/pull', (c) => {
    const raw = c.req.query('cursor')
    if (raw !== undefined) {
      const cursor = parseCursorParam(raw)
      if (cursor === null) return c.json({ error: 'invalid_cursor' }, 400)
      return c.json(c.get('sync').pullSpaces(c.get('userId'), cursor, undefined, c.get('grants')))
    }
    const parsed = PullQuery.safeParse(c.req.query())
    if (!parsed.success) {
      return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400)
    }
    return c.json(
      c.get('sync').pull(c.get('userId'), parsed.data.since, undefined, c.get('grants')),
    )
  })

  // `?space=<id>`: only that space (404 when the user is not a member of it).
  app.get('/snapshot', (c) => {
    const space = c.req.query('space') ?? null
    const body = c.get('sync').snapshot(c.get('userId'), c.get('grants'), space)
    if (space !== null && body.spaces.length === 0) return c.json({ error: 'not_found' }, 404)
    return c.json(body)
  })

  return app
}
