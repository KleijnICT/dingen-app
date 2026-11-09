import type { HealthStatus } from '@dingen/core'
import { APP_NAME } from '@dingen/core'
import { Hono } from 'hono'
import type { Db } from './db.js'
import type { AppEnv } from './env.js'
import { syncRoutes } from './routes/sync.js'
import { SyncService } from './sync.js'

export interface AppDeps {
  db: Db
  version: string
  sqliteVersion: string
}

/** Tot onderdeel 3 (accounts) draait alles onder één vaste ontwikkelgebruiker. */
const DEV_USER_ID = 'dev'

/** Bouwt de Hono-app zonder HTTP-server of statische bestanden, zodat tests hem direct kunnen aanroepen. */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const sync = new SyncService(deps.db)

  app.use('/api/*', async (c, next) => {
    c.set('sync', sync)
    c.set('userId', DEV_USER_ID)
    await next()
  })

  app.get('/api/health', (c) => {
    const body: HealthStatus = {
      status: 'ok',
      app: APP_NAME,
      version: deps.version,
      database: 'ok',
      sqliteVersion: deps.sqliteVersion,
    }
    return c.json(body)
  })

  app.route('/api/sync', syncRoutes())

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'not_found' }, 404)
    }
    return c.text('Not found', 404)
  })

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'internal' }, 500)
  })

  return app
}
