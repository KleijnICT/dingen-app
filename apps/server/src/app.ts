import type { HealthStatus } from '@dingen/core'
import { APP_NAME } from '@dingen/core'
import { Hono } from 'hono'
import { ActivityService } from './activity/service.js'
import { InvitationService } from './auth/invitations.js'
import { authenticate, requireAuth } from './auth/middleware.js'
import { AuthService } from './auth/service.js'
import { CalendarService, type FetchFeed } from './calendar/service.js'
import type { RegistrationMode } from './config.js'
import type { Db } from './db.js'
import type { AppEnv } from './env.js'
import { PushService, webPushSender } from './push/service.js'
import { loadVapidKeys } from './push/vapid.js'
import { activityRoutes } from './routes/activity.js'
import { authRoutes } from './routes/auth.js'
import { calendarRoutes } from './routes/calendars.js'
import { dataRoutes } from './routes/data.js'
import { invitationRoutes } from './routes/invitations.js'
import { mcpRoutes } from './routes/mcp.js'
import { pushRoutes } from './routes/push.js'
import { syncRoutes } from './routes/sync.js'
import { SyncService } from './sync.js'

export interface AppDeps {
  db: Db
  version: string
  /** Korte commit-hash van de build (DINGEN_COMMIT). */
  build?: string | null
  sqliteVersion: string
  /** Wie een account mag maken naast de eerste gebruiker (DINGEN_REGISTRATION). */
  registration?: RegistrationMode
  /** Verkorte vorm voor tests: true is `open`. `registration` gaat voor. */
  registrationOpen?: boolean
  /** Tijdzone waarin "vandaag" wordt bepaald voor de MCP; de browser gebruikt zijn eigen klok. */
  timezone?: string
  /** Ophalen van agenda-feeds; tests geven een nep-versie mee. */
  fetchFeed?: FetchFeed
  /** Demo mode (DINGEN_DEMO): passwordless sign-in as one of the demo accounts. */
  demo?: boolean
  /** Web push; zonder wordt er een gemaakt met de sleutels uit de database. */
  push?: PushService
}

/** Bouwt de Hono-app zonder HTTP-server of statische bestanden, zodat tests hem direct kunnen aanroepen. */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const sync = new SyncService(deps.db)
  const auth = new AuthService(deps.db, {
    registration: deps.registration ?? (deps.registrationOpen ? 'open' : 'closed'),
  })

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
  const activity = new ActivityService(deps.db)
  app.route('/mcp', mcpRoutes(deps.timezone ?? 'Europe/Amsterdam', deps.db, activity))

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

  app.route('/api/auth', authRoutes({ demo: deps.demo ?? false }))
  app.use('/api/sync/*', requireAuth)
  app.route('/api/sync', syncRoutes())
  app.use('/api/export', requireAuth)
  app.use('/api/import', requireAuth)
  app.route('/api', dataRoutes(deps.db, deps.version))

  // --- activity (Logbook) ---
  app.use('/api/activity', requireAuth)
  app.route('/api/activity', activityRoutes(deps.db, activity))

  const calendars = new CalendarService(deps.db, { fetchFeed: deps.fetchFeed })
  app.use('/api/calendars', requireAuth)
  app.use('/api/calendars/*', requireAuth)
  app.route('/api/calendars', calendarRoutes(calendars, deps.timezone ?? 'Europe/Amsterdam'))

  // --- herinneringen ---
  const push = deps.push ?? defaultPush(deps.db)
  app.use('/api/push/*', requireAuth)
  app.route('/api/push', pushRoutes(push))

  // --- uitnodigingen ---
  app.use('/api/invitations', requireAuth)
  app.use('/api/invitations/*', requireAuth)
  app.route('/api/invitations', invitationRoutes(new InvitationService(deps.db)))

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

/** Push met de VAPID-sleutels van deze server (uit env of database). */
export function defaultPush(db: Db): PushService {
  const keys = loadVapidKeys(db)
  return new PushService(db, keys.publicKey, webPushSender(keys))
}
