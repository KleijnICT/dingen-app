import type { HealthStatus } from '@dingen/core'
import { APP_NAME, SYNC_PROTOCOL } from '@dingen/core'
import { type Context, Hono, type Next } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ActivityService } from './activity/service.js'
import { AgentService } from './agents/service.js'
import { InvitationService } from './auth/invitations.js'
import { authenticate, requireAllScope, requireAuth } from './auth/middleware.js'
import { PasswordResetService } from './auth/reset.js'
import { AuthService } from './auth/service.js'
import { TwoStepService } from './auth/two-step.js'
import { CalendarService, type FetchFeed } from './calendar/service.js'
import type { RegistrationMode } from './config.js'
import type { Db } from './db.js'
import type { AppEnv } from './env.js'
import { ingressGate, SUPERVISOR_ADDRESS } from './ingress.js'
import { MailService } from './mail/service.js'
import { AssignmentNotifier } from './push/assigned.js'
import { PushService, webPushSender } from './push/service.js'
import { loadVapidKeys } from './push/vapid.js'
import { activityRoutes } from './routes/activity.js'
import { adminSecurityRoutes } from './routes/admin-security.js'
import { agentRoutes } from './routes/agents.js'
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
  /**
   * Addresses allowed on the Home Assistant ingress listener (requests with
   * `c.env.ingress`); default the Supervisor. Ignored on the normal port.
   */
  ingressTrusted?: readonly string[]
  /** Outgoing mail (SMTP_*); without, mail is off and "Forgot password?" is hidden. */
  mail?: MailService
  /** DINGEN_PUBLIC_URL: the address links in mail point to. */
  publicUrl?: string | null
}

/** Bouwt de Hono-app zonder HTTP-server of statische bestanden, zodat tests hem direct kunnen aanroepen. */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const push = deps.push ?? defaultPush(deps.db)
  const assignments = new AssignmentNotifier(deps.db, push)
  // An agent assigning a task to a person sends that person a push (plan 19, decision 10).
  const sync = new SyncService(deps.db, {
    onAssigned: (list) => void assignments.notify(list).catch((err) => console.error(err)),
  })
  const auth = new AuthService(deps.db, {
    registration: deps.registration ?? (deps.registrationOpen ? 'open' : 'closed'),
  })

  const agents = new AgentService(deps.db)
  // First, for every path (API and web app): only does something on the ingress listener.
  app.use('*', ingressGate(auth, deps.ingressTrusted ?? [SUPERVISOR_ADDRESS]))
  const services = async (c: Context<AppEnv>, next: Next) => {
    c.set('sync', sync)
    c.set('auth', auth)
    c.set('agents', agents)
    await next()
  }

  app.use('/api/*', services)
  app.use('/api/*', authenticate)
  app.use('/mcp', services)
  app.use('/mcp', authenticate)
  const activity = new ActivityService(deps.db)
  app.route('/mcp', mcpRoutes(deps.timezone ?? 'Europe/Amsterdam', activity))

  app.get('/api/health', (c) => {
    const body: HealthStatus = {
      status: 'ok',
      app: APP_NAME,
      version: deps.version,
      build: deps.build ?? null,
      database: 'ok',
      sqliteVersion: deps.sqliteVersion,
      syncProtocol: SYNC_PROTOCOL,
    }
    return c.json(body)
  })

  // --- mail, password resets and two-step verification (plan 32) ---
  const mail = deps.mail ?? new MailService(null)
  const resets = new PasswordResetService(deps.db, mail)
  const twoStep = new TwoStepService(deps.db)
  const publicUrl = deps.publicUrl ?? null
  app.route('/api/auth', authRoutes({ demo: deps.demo ?? false, mail, resets, twoStep, publicUrl }))
  app.route('/api/admin', adminSecurityRoutes({ mail, resets, twoStep, publicUrl }))
  app.route('/api', agentRoutes())
  // Account-wide endpoints: the owner, or an agent with an `all` grant.
  app.use('/api/sync/*', requireAllScope('read'))
  app.route('/api/sync', syncRoutes())
  app.use('/api/export', requireAllScope('read'))
  app.use('/api/import', requireAllScope('manage'))
  app.route('/api', dataRoutes(deps.db, deps.version))

  // --- activity (Logbook) ---
  app.use('/api/activity', requireAuth)
  app.route('/api/activity', activityRoutes(activity))

  const calendars = new CalendarService(deps.db, { fetchFeed: deps.fetchFeed })
  // Reading calendars needs Everything (read); adding, changing or removing one needs Everything (manage).
  const calendarScope = createMiddleware<AppEnv>((c, next) =>
    requireAllScope(c.req.method === 'GET' ? 'read' : 'manage')(c, next),
  )
  app.use('/api/calendars', calendarScope)
  app.use('/api/calendars/*', calendarScope)
  app.route('/api/calendars', calendarRoutes(calendars, deps.timezone ?? 'Europe/Amsterdam'))

  // --- herinneringen ---
  app.use('/api/push/*', requireAllScope('read'))
  app.route('/api/push', pushRoutes(push))

  // --- uitnodigingen ---
  app.use('/api/invitations', requireAllScope('manage'))
  app.use('/api/invitations/*', requireAllScope('manage'))
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
