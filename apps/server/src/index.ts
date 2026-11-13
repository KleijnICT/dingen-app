import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp, defaultPush } from './app.js'
import { BackupScheduler } from './backup-scheduler.js'
import { applyLogLevel, loadConfig } from './config.js'
import { migrationsFolder, type OpenedDatabase } from './db.js'
import { resetToDemo } from './demo/seed.js'
import { DataDirLock } from './lock.js'
import { ReminderPlanner } from './push/planner.js'
import { prepareDatabase, StartupError } from './startup.js'
import { mountWeb } from './static.js'

const config = loadConfig()
applyLogLevel(config.logLevel)
if (config.homeAssistant) {
  console.log(
    `Home Assistant mode: ingress on port ${config.homeAssistant.ingressPort} (trusted: ${config.homeAssistant.ingressTrusted.join(', ')}), registration ${config.registration}, time zone ${config.timezone}`,
  )
}

// One server per data directory; `dingen restore` takes the same lock, so it
// refuses while the server runs (see lock.ts).
let lock: DataDirLock | null = null
try {
  lock = DataDirLock.acquire(config.dataDir)
  if (lock === null) {
    console.error(`Another Dingen server or a restore is using ${config.dataDir}; not starting.`)
    process.exit(1)
  }
} catch (err) {
  console.warn(
    `Could not lock ${config.dataDir} (${err instanceof Error ? err.message : String(err)}); starting without the lock, so \`dingen restore\` cannot tell that the server runs.`,
  )
}
// Held for the life of the process; the system releases it on exit.
process.on('exit', () => lock?.release())

// A backup before SQL or data migrations; if a migration fails, that backup
// comes back and the server stops (see startup.ts).
let opened: OpenedDatabase
try {
  opened = await prepareDatabase({
    databasePath: config.databasePath,
    backupDir: config.backupDir,
    migrationsFolder,
  })
} catch (err) {
  if (!(err instanceof StartupError)) throw err
  for (const line of err.message.split('\n')) console.error(line)
  process.exit(1)
}
const { db, sqlite, sqliteVersion } = opened

if (config.demo) {
  console.warn('DEMO MODE (DINGEN_DEMO): wiping all accounts and data and writing the demo set.')
  const seeded = await resetToDemo(db, { timezone: config.timezone })
  for (const user of seeded.users) {
    console.warn(`Demo account ${user.email}: ${user.entities} entities`)
  }
  console.warn('Demo mode: passwordless sign-in is on. Data resets on every restart.')
}

const push = defaultPush(db)
const app = createApp({
  push,
  db,
  version: config.version,
  build: config.build,
  sqliteVersion,
  registration: config.registration,
  timezone: config.timezone,
  demo: config.demo,
  ...(config.homeAssistant ? { ingressTrusted: config.homeAssistant.ingressTrusted } : {}),
})

// Onbekende API-paden krijgen JSON, nooit de SPA-fallback.
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
  mountWeb(app, config.webDist)
} else {
  console.warn(`Web build not found at ${config.webDist}; serving the API only.`)
}

new ReminderPlanner(db, push, { timezone: config.timezone }).start()

if (config.backups) {
  new BackupScheduler(sqlite, {
    backupDir: config.backupDir,
    migrationsFolder,
    timezone: config.timezone,
  }).start()
} else {
  console.log('Nightly backups are off (DINGEN_BACKUPS); backups before an update are still made.')
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `Dingen ${config.version}${config.build ? ` (${config.build})` : ''} listening on http://localhost:${info.port}`,
  )
  console.log(`Database: ${config.databasePath}`)
})

if (config.homeAssistant) {
  // Home Assistant ingress: the same app, but the listener marks its requests,
  // so ingressGate only lets the Supervisor in and signs in the HA user.
  serve(
    {
      fetch: (req, env) => app.fetch(req, { ...(env as object), ingress: true }),
      port: config.homeAssistant.ingressPort,
    },
    (info) => console.log(`Home Assistant ingress listening on port ${info.port}`),
  )
}
