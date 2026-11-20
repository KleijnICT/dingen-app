import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { Hono } from 'hono'
import { seedRegistration } from './admin/registration.js'
import { createApp, defaultPush } from './app.js'
import { BackupScheduler } from './backup-scheduler.js'
import type { Config } from './config.js'
import { type Db, migrationsFolder as defaultMigrations, type OpenedDatabase } from './db.js'
import { resetToDemo } from './demo/seed.js'
import type { AppBindings, AppEnv } from './env.js'
import { MailService } from './mail/service.js'
import { ChangeLogPruner } from './prune.js'
import { ReminderPlanner } from './push/planner.js'
import { replaceDatabase } from './restore.js'
import { prepareDatabase } from './startup.js'
import { mountWeb } from './static.js'

/** What the restore keeps: the asking administrator's session (hashed), when their account is in the back-up. */
export interface KeepSession {
  id: string
  userId: string
}

export interface RuntimeOptions {
  migrationsFolder?: string
  log?: Pick<Console, 'log' | 'warn' | 'error'>
  /** Start the timers (reminders, nightly back-ups, pruning); off in tests. */
  timers?: boolean
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The running server minus its listeners: the open database, the Hono app
 * and the timers. `index.ts` listens with `runtime.fetch`, so the runtime can
 * swap all of it underneath: a restore from Administration (plan 32, decision
 * 6) closes the database, puts the back-up in its place and starts again
 * (migrations included) in the same process. That works the same in Docker,
 * in Home Assistant and without either, and needs no restart policy. While it
 * runs, requests get 503 `restarting`. Clients resync on their own: the
 * restore records the lost `seq` range (see restore.ts).
 */
export class ServerRuntime {
  private opened!: OpenedDatabase
  private app!: Hono<AppEnv>
  private stops: (() => void)[] = []
  private restoring = false
  private readonly migrationsFolder: string
  private readonly log: Pick<Console, 'log' | 'warn' | 'error'>
  /** Outgoing mail lives outside the database, so a restore keeps it. */
  private readonly mail: MailService

  private constructor(
    private readonly config: Config,
    private readonly options: RuntimeOptions,
  ) {
    this.migrationsFolder = options.migrationsFolder ?? defaultMigrations
    this.log = options.log ?? console
    this.mail = new MailService(config.mail)
  }

  /** Opens the database (back-up and migrations first, see startup.ts) and builds the app. */
  static async start(config: Config, options: RuntimeOptions = {}): Promise<ServerRuntime> {
    const runtime = new ServerRuntime(config, options)
    await runtime.boot(true)
    return runtime
  }

  get db(): Db {
    return this.opened.db
  }

  get sqlite(): Database.Database {
    return this.opened.sqlite
  }

  /** Is a restore busy? */
  get busy(): boolean {
    return this.restoring
  }

  fetch = (req: Request, env?: AppBindings): Response | Promise<Response> => {
    if (this.restoring) {
      return Response.json(
        { error: 'restarting' },
        { status: 503, headers: { 'retry-after': '2', 'cache-control': 'no-store' } },
      )
    }
    return this.app.fetch(req, env)
  }

  private async boot(first: boolean): Promise<void> {
    const { config } = this
    this.opened = await prepareDatabase({
      databasePath: config.databasePath,
      backupDir: config.backupDir,
      migrationsFolder: this.migrationsFolder,
      log: this.log,
    })
    const { db, sqlite, sqliteVersion } = this.opened

    if (first && config.demo) {
      this.log.warn(
        'DEMO MODE (DINGEN_DEMO): wiping all accounts and data and writing the demo set.',
      )
      const seeded = await resetToDemo(db, { timezone: config.timezone })
      for (const user of seeded.users) {
        this.log.warn(`Demo account ${user.email}: ${user.entities} entities`)
      }
      this.log.warn('Demo mode: passwordless sign-in is on. Data resets on every restart.')
    }

    if (first) {
      const registration = seedRegistration(db, config.registration)
      if (registration.ignored) {
        this.log.log(
          `Registration is ${registration.mode} (set in Administration); the starting value ${config.registration} is not used.`,
        )
      }
    }

    if (first) {
      // Mail settings come from the environment only; the password is never logged.
      if (config.mail) {
        this.log.log(
          `Mail: SMTP ${config.mail.host}:${config.mail.port}${config.mail.secure ? ' (TLS)' : ''}, from ${config.mail.from}`,
        )
        if (!config.publicUrl) {
          this.log.warn(
            'DINGEN_PUBLIC_URL is not set: "Forgot password?" stays off until it is. Set it to the address people open Dingen on.',
          )
        }
      } else {
        this.log.log('Mail is off (no SMTP_HOST and SMTP_FROM); "Forgot password?" is hidden.')
      }
    }

    const push = defaultPush(db)
    const app = createApp({
      push,
      mail: this.mail,
      publicUrl: config.publicUrl,
      db,
      version: config.version,
      build: config.build,
      sqliteVersion,
      registration: config.registration,
      timezone: config.timezone,
      demo: config.demo,
      ...(config.homeAssistant ? { ingressTrusted: config.homeAssistant.ingressTrusted } : {}),
      backups: {
        sqlite,
        backupDir: config.backupDir,
        migrationsFolder: this.migrationsFolder,
        restore: (file, keep, fallback) => void this.restore(file, keep, fallback),
      },
    })
    // Onbekende API-paden krijgen JSON, nooit de SPA-fallback.
    app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))
    if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
      mountWeb(app, config.webDist)
    } else if (first) {
      this.log.warn(`Web build not found at ${config.webDist}; serving the API only.`)
    }
    this.app = app

    this.stops = []
    if (this.options.timers === false) return
    const planner = new ReminderPlanner(db, push, { timezone: config.timezone })
    planner.start()
    this.stops.push(() => planner.stop())
    // The change log keeps a year (see prune.ts): pruned daily after the nightly
    // backup, and at startup when overdue.
    const backups = config.backups
      ? new BackupScheduler(sqlite, {
          backupDir: config.backupDir,
          migrationsFolder: this.migrationsFolder,
          timezone: config.timezone,
          afterBackup: () => void pruner.tick(),
        })
      : null
    const pruner = new ChangeLogPruner(sqlite, {
      timezone: config.timezone,
      ...(backups ? { backupPending: () => backups.due() } : {}),
    })
    if (backups) {
      backups.start()
      this.stops.push(() => backups.stop())
    } else if (first) {
      this.log.log(
        'Nightly backups are off (DINGEN_BACKUPS); backups before an update are still made.',
      )
    }
    pruner.start()
    this.stops.push(() => pruner.stop())
  }

  private shutDown(): void {
    for (const stop of this.stops) stop()
    this.stops = []
    this.opened.close()
  }

  /**
   * Puts the back-up `file` in place of the database and starts again. When
   * that fails, `fallback` (the back-up made just before) goes back instead.
   * Resolves when the server answers again.
   */
  async restore(file: string, keep: KeepSession | null, fallback: string | null): Promise<void> {
    if (this.restoring) return
    this.restoring = true
    try {
      this.shutDown()
      try {
        replaceDatabase(this.config.databasePath, file, {
          check: { migrationsFolder: this.migrationsFolder },
        })
        await this.boot(false)
        this.log.log(`Restored ${path.basename(file)}; the server runs on it now.`)
      } catch (err) {
        this.log.error(
          `Restoring ${path.basename(file)} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        if (!fallback) throw err
        replaceDatabase(this.config.databasePath, fallback)
        await this.boot(false)
        this.log.error(`Put back ${path.basename(fallback)}; the database is as it was.`)
      }
      if (keep) this.keepSession(keep)
    } catch (err) {
      this.log.error(
        `The server could not start again after a restore: ${err instanceof Error ? err.message : String(err)}`,
      )
      process.exit(1)
    } finally {
      this.restoring = false
    }
  }

  /** The administrator stays signed in when their account (not blocked) is in the restored database. */
  private keepSession(keep: KeepSession): void {
    const sqlite = this.opened.sqlite
    const user = sqlite
      .prepare('select id from users where id = ? and blocked_at is null')
      .get(keep.userId)
    if (!user) return
    const now = new Date()
    sqlite
      .prepare(
        'insert or ignore into sessions (id, user_id, created_at, expires_at, last_seen_at) values (?, ?, ?, ?, ?)',
      )
      .run(
        keep.id,
        keep.userId,
        now.toISOString(),
        new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
        now.toISOString(),
      )
  }

  /** Stops the timers and closes the database (tests). */
  close(): void {
    this.shutDown()
  }
}
