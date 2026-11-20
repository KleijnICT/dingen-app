import {
  CLIENT_OUTDATED_STATUS,
  clientOutdatedBody,
  MIN_CLIENT_PROTOCOL,
  PROTOCOL_HEADER,
  parseCursorParam,
  requestProtocol,
} from '@dingen/core'
import { Hono } from 'hono'
import { AgentScopeError } from '../agents/access.js'
import { accessOf } from '../auth/middleware.js'
import type { AppEnv } from '../env.js'
import { SpaceAccessError } from '../spaces/service.js'
import { normalizePushedTag, PushBody, SyncValidationError } from '../sync.js'

/**
 * Sync-API. Vereist een ingelogde gebruiker (`userId` in de context); agents
 * only with an `all` grant (see app.ts), and their writes are still checked.
 * The shapes are in core (protocol.ts) and pinned by the contract test.
 *
 * Every request names its protocol in the `x-dingen-protocol` header. One
 * that names an older protocol than `MIN_CLIENT_PROTOCOL`, or none, gets 426
 * `{ error: 'client_outdated', protocol, minProtocol, message }`: the web app
 * reloads to get the new version, the MCP plugin tells the user to update.
 *
 * - `GET /pull?cursor=<url-encoded JSON {"<spaceId>": seq}>` answers per
 *   space (`PullResponse`).
 * - `POST /push` with `{ changes, cursor? }` answers `PushResponse`.
 * - `GET /snapshot[?space=<id>]` answers `SnapshotResponse`.
 */
export function syncRoutes() {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    const protocol = requestProtocol(c.req.header(PROTOCOL_HEADER))
    if (protocol < MIN_CLIENT_PROTOCOL) {
      return c.json(clientOutdatedBody(protocol), CLIENT_OUTDATED_STATUS)
    }
    await next()
  })

  app.post('/push', async (c) => {
    const parsed = PushBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    }
    const sync = c.get('sync')
    const userId = c.get('userId')
    try {
      const result = sync.push(userId, parsed.data.changes.map(normalizePushedTag), {
        access: accessOf(c),
        members: c.get('agents').memberGrants(userId),
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
    const cursor = parseCursorParam(c.req.query('cursor') ?? '')
    if (cursor === null) return c.json({ error: 'invalid_cursor' }, 400)
    return c.json(c.get('sync').pullSpaces(c.get('userId'), cursor, undefined, c.get('grants')))
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
