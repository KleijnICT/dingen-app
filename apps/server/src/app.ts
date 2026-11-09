import type { HealthStatus } from '@dingen/core'
import { APP_NAME } from '@dingen/core'
import { Hono } from 'hono'
import type { Db } from './db.js'

export interface AppDeps {
  db: Db
  version: string
  sqliteVersion: string
}

/** Bouwt de Hono-app zonder HTTP-server of statische bestanden, zodat tests hem direct kunnen aanroepen. */
export function createApp(deps: AppDeps) {
  const app = new Hono()

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

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'not_found' }, 404)
    }
    return c.text('Not found', 404)
  })

  return app
}
