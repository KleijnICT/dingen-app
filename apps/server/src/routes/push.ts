import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.js'
import type { PushService } from '../push/service.js'

const Key = z.string().min(1).max(512)
const Endpoint = z.string().url().max(2048)
const SubscribeBody = z.object({
  endpoint: Endpoint,
  keys: z.object({ p256dh: Key, auth: Key }),
})
const UnsubscribeBody = z.object({ endpoint: Endpoint })
/** De client geeft de tekst van de proefmelding mee, in de taal van de gebruiker. */
const TestBody = z.object({
  title: z.string().max(200).default('Dingen'),
  body: z.string().max(500).default(''),
})

/** Web-push-abonnementen van de ingelogde gebruiker, één per apparaat. */
export function pushRoutes(service: PushService) {
  const app = new Hono<AppEnv>()

  app.get('/key', (c) => c.json({ publicKey: service.publicKey }))

  app.post('/subscriptions', async (c) => {
    const parsed = SubscribeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
    const endpoint = new URL(parsed.data.endpoint)
    if (endpoint.protocol !== 'https:') return c.json({ error: 'invalid_body' }, 400)
    const userAgent = c.req.header('user-agent')?.slice(0, 300) ?? null
    service.subscribe(c.get('userId'), parsed.data, userAgent)
    return c.json({ ok: true }, 201)
  })

  app.delete('/subscriptions', async (c) => {
    const parsed = UnsubscribeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
    service.unsubscribe(c.get('userId'), parsed.data.endpoint)
    return c.json({ ok: true })
  })

  app.post('/test', async (c) => {
    const parsed = TestBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
    const sent = await service.send(c.get('userId'), {
      ...parsed.data,
      tag: 'dingen-test',
      url: '/today',
    })
    return c.json({ sent })
  })

  return app
}
