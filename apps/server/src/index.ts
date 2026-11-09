import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { openDatabase } from './db.js'

const config = loadConfig()
const { db, sqliteVersion } = openDatabase(config.databasePath)
const app = createApp({
  db,
  version: config.version,
  sqliteVersion,
  registrationOpen: config.registrationOpen,
  timezone: config.timezone,
})

// Onbekende API-paden krijgen JSON, nooit de SPA-fallback.
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

if (fs.existsSync(config.webDist)) {
  // serveStatic werkt met paden relatief aan de huidige werkmap.
  const root = path.relative(process.cwd(), config.webDist) || '.'
  app.use('/*', serveStatic({ root }))
  app.get('/*', serveStatic({ root, path: 'index.html' }))
} else {
  console.warn(`Web build not found at ${config.webDist}; serving the API only.`)
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Dingen ${config.version} listening on http://localhost:${info.port}`)
  console.log(`Database: ${config.databasePath}`)
})
