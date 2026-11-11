import { Hono } from 'hono'
import type { InvitationService } from '../auth/invitations.js'
import type { AppEnv } from '../env.js'

/**
 * Uitnodigingen beheren; alleen voor de beheerder. Maken en intrekken vereisen
 * een browsersessie, net als API-tokens: een gelekt token mag geen accounts openzetten.
 */
export function invitationRoutes(invitations: InvitationService) {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    if (!c.get('user')?.isAdmin) return c.json({ error: 'forbidden' }, 403)
    await next()
  })

  app.get('/', (c) => c.json({ invitations: invitations.list() }))

  app.post('/', (c) => {
    if (c.get('authSource') !== 'session') return c.json({ error: 'session_required' }, 403)
    const { token, info } = invitations.create(c.get('userId'))
    return c.json({ token, invitation: info }, 201)
  })

  app.delete('/:id', (c) => {
    if (c.get('authSource') !== 'session') return c.json({ error: 'session_required' }, 403)
    const result = invitations.revoke(c.req.param('id'))
    if (result === 'not_found') return c.json({ error: 'not_found' }, 404)
    if (result === 'already_used') return c.json({ error: 'already_used' }, 409)
    return c.json({ ok: true })
  })

  return app
}
