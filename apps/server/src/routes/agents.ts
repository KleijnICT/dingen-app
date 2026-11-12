import {
  AGENT_LEVELS,
  type AgentGrant,
  AREA_COLORS,
  AREA_ICONS,
  isDeleted,
  type Place,
} from '@dingen/core'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { canRead } from '../agents/access.js'
import { requireAuth, requireSession } from '../auth/middleware.js'
import type { AppEnv } from '../env.js'

const Level = z.enum(AGENT_LEVELS)
const Id = z.string().min(1).max(100)

const Grant = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all'), level: Level }),
  z.object({ scope: z.literal('inbox'), level: Level }),
  z.object({ scope: z.literal('area'), id: Id, level: Level }),
  z.object({ scope: z.literal('project'), id: Id, level: Level }),
])

const AgentBody = z.object({
  name: z.string().trim().min(1).max(100),
  icon: z.enum(AREA_ICONS),
  color: z.enum(AREA_COLORS),
  grants: z.array(Grant).max(200),
})

const AgentPatch = AgentBody.partial()

const AccessQuery = z.object({ type: z.enum(['area', 'project']), id: Id })

type Ctx = Context<AppEnv>

/** Grants must point at areas and projects of this user. */
function unknownGrant(c: Ctx, grants: AgentGrant[]): boolean {
  const lookup = c.get('sync').lookupFor(c.get('userId'))
  return grants.some((g) => {
    if (g.scope !== 'area' && g.scope !== 'project') return false
    const record = lookup(g.scope, g.id)
    return !record || isDeleted(record)
  })
}

/** `/api/members`, `/api/agents` and `/api/access` (plan 19). */
export function agentRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/members', requireAuth, (c) =>
    c.json({ members: c.get('agents').members(c.get('userId')) }),
  )

  app.get('/agents', requireSession, (c) =>
    c.json({ agents: c.get('agents').list(c.get('userId')) }),
  )

  app.post('/agents', requireSession, async (c) => {
    const parsed = AgentBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    if (unknownGrant(c, parsed.data.grants)) return c.json({ error: 'invalid_grant' }, 400)
    const created = c.get('agents').create(c.get('userId'), parsed.data)
    return c.json(created, 201)
  })

  app.patch('/agents/:id', requireSession, async (c) => {
    const parsed = AgentPatch.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    if (parsed.data.grants && unknownGrant(c, parsed.data.grants))
      return c.json({ error: 'invalid_grant' }, 400)
    const agent = c.get('agents').update(c.get('userId'), c.req.param('id'), parsed.data)
    return agent ? c.json({ agent }) : c.json({ error: 'not_found' }, 404)
  })

  app.post('/agents/:id/token', requireSession, (c) => {
    const rotated = c.get('agents').rotate(c.get('userId'), c.req.param('id'))
    return rotated ? c.json(rotated) : c.json({ error: 'not_found' }, 404)
  })

  app.delete('/agents/:id', requireSession, (c) => {
    const revoked = c.get('agents').revoke(c.get('userId'), c.req.param('id'))
    return revoked ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404)
  })

  app.get('/access', requireAuth, (c) => {
    const parsed = AccessQuery.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400)
    const { type, id } = parsed.data
    const userId = c.get('userId')
    const lookup = c.get('sync').lookupFor(userId)
    const record = lookup(type, id)
    // An agent only learns about places it can read.
    if (!record || isDeleted(record) || !canRead(c.get('grants'), record, lookup)) {
      return c.json({ error: 'not_found' }, 404)
    }
    const place: Place =
      type === 'area'
        ? { kind: 'area', areaId: id }
        : {
            kind: 'project',
            projectId: id,
            areaId: typeof record.data.areaId === 'string' ? record.data.areaId : null,
          }
    return c.json({ members: c.get('agents').accessTo(userId, place) })
  })

  return app
}
