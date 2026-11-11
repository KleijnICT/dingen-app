import type { HealthStatus } from '@dingen/core'
import { APP_NAME } from '@dingen/core'
import { Hono } from 'hono'
import { authenticate, requireAuth } from './auth/middleware.js'
import { AuthService } from './auth/service.js'
import type { Db } from './db.js'
import type { AppEnv } from './env.js'
import { authRoutes } from './routes/auth.js'
import { dataRoutes } from './routes/data.js'
import { mcpRoutes } from './routes/mcp.js'
import { syncRoutes } from './routes/sync.js'
import { SyncService } from './sync.js'

export interface AppDeps {
  db: Db
  version: string
  /** Korte commit-hash van de build (DINGEN_COMMIT). */
  build?: string | null
  sqliteVersion: string
  /** Registratie open voor iedereen (hosted) of alleen voor de eerste gebruiker. */
  registrationOpen?: boolean
  /** Tijdzone waarin "vandaag" wordt bepaald voor de MCP; de browser gebruikt zijn eigen klok. */
  timezone?: string
}

/** Bouwt de Hono-app zonder HTTP-server of statische bestanden, zodat tests hem direct kunnen aanroepen. */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const sync = new SyncService(deps.db)
  const auth = new AuthService(deps.db, { registrationOpen: deps.registrationOpen ?? false })

  app.use('/api/*', async (c, next) => {
    c.set('sync', sync)
    c.set('auth', auth)
    await next()
  })
  app.use('/api/*', authenticate)
  app.use('/mcp', async (c, next) => {
    c.set('sync', sync)
    c.set('auth', auth)
    await next()
  })
  app.use('/mcp', authenticate)
  app.route('/mcp', mcpRoutes(deps.timezone ?? 'Europe/Amsterdam'))

  app.get('/api/health', (c) => {
    const body: HealthStatus = {
      status: 'ok',
      app: APP_NAME,
      version: deps.version,
      build: deps.build ?? null,
      database: 'ok',
      sqliteVersion: deps.sqliteVersion,
    }
    return c.json(body)
  })

  app.route('/api/auth', authRoutes())
  app.use('/api/sync/*', requireAuth)
  app.route('/api/sync', syncRoutes())
  app.use('/api/export', requireAuth)
  app.use('/api/import', requireAuth)
  app.route('/api', dataRoutes(deps.db, deps.version))

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
