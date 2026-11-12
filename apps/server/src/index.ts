import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context } from 'hono'
import { createApp, defaultPush } from './app.js'
import { backupBeforeMigrations } from './backup.js'
import { loadConfig } from './config.js'
import { migrationsFolder, openDatabase } from './db.js'
import { resetToDemo } from './demo/seed.js'
import { ReminderPlanner } from './push/planner.js'
import { staticHeaders } from './static.js'

const config = loadConfig()

// Staan er migraties klaar voor een bestaande database, dan eerst een kopie.
// Lukt die niet, dan niet migreren: liever niet starten dan data riskeren.
try {
  const backup = await backupBeforeMigrations({
    databasePath: config.databasePath,
    backupDir: path.join(config.dataDir, 'backups'),
    migrationsFolder,
  })
  if (backup) {
    console.log(
      `Database migration ${backup.from} → ${backup.to}: backup written to ${backup.file}`,
    )
  }
} catch (err) {
  console.error(
    `Could not back up the database before migrating; not starting. ${err instanceof Error ? err.message : String(err)}`,
  )
  console.error(
    `Check free disk space and write access to ${path.join(config.dataDir, 'backups')}.`,
  )
  process.exit(1)
}

const { db, sqliteVersion } = openDatabase(config.databasePath)

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
})

// Onbekende API-paden krijgen JSON, nooit de SPA-fallback.
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

if (fs.existsSync(config.webDist)) {
  // serveStatic werkt met paden relatief aan de huidige werkmap.
  const root = path.relative(process.cwd(), config.webDist) || '.'
  const setHeaders = (_file: string, c: Context) => {
    for (const [name, value] of Object.entries(staticHeaders(new URL(c.req.url).pathname))) {
      c.header(name, value)
    }
  }
  app.use('/*', serveStatic({ root, onFound: setHeaders }))
  app.get('/*', serveStatic({ root, path: 'index.html', onFound: setHeaders }))
} else {
  console.warn(`Web build not found at ${config.webDist}; serving the API only.`)
}

new ReminderPlanner(db, push, { timezone: config.timezone }).start()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `Dingen ${config.version}${config.build ? ` (${config.build})` : ''} listening on http://localhost:${info.port}`,
  )
  console.log(`Database: ${config.databasePath}`)
})
