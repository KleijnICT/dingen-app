import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context } from 'hono'
import { createApp, defaultPush } from './app.js'
import { loadConfig } from './config.js'
import { openDatabase } from './db.js'
import { ReminderPlanner } from './push/planner.js'
import { staticHeaders } from './static.js'

const config = loadConfig()
const { db, sqliteVersion } = openDatabase(config.databasePath)
const push = defaultPush(db)
const app = createApp({
  push,
  db,
  version: config.version,
  build: config.build,
  sqliteVersion,
  registrationOpen: config.registrationOpen,
  timezone: config.timezone,
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
