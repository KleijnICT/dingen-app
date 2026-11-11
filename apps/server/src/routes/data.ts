import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Db } from '../db.js'
import type { AppEnv } from '../env.js'
import { buildExport, parseExport } from '../export.js'
import { SyncValidationError } from '../sync.js'

const MAX_IMPORT_BYTES = 50 * 1024 * 1024

/** Export en import van alle gegevens van de ingelogde gebruiker. */
export function dataRoutes(db: Db, version: string) {
  const app = new Hono<AppEnv>()

  app.get('/export', (c) => {
    const file = buildExport(db, c.get('userId'), version)
    const day = file.exportedAt.slice(0, 10)
    c.header('content-disposition', `attachment; filename="dingen-export-${day}.json"`)
    c.header('cache-control', 'no-store')
    return c.body(JSON.stringify(file), 200, { 'content-type': 'application/json' })
  })

  app.post(
    '/import',
    bodyLimit({
      maxSize: MAX_IMPORT_BYTES,
      onError: (c) => c.json({ error: 'too_large' }, 413),
    }),
    async (c) => {
      const mode = c.req.query('mode') ?? 'merge'
      if (mode !== 'merge' && mode !== 'reject') {
        return c.json({ error: 'invalid_mode' }, 400)
      }
      const parsed = parseExport(await c.req.json().catch(() => null))
      if (!parsed.ok) return c.json({ error: 'invalid_export', issues: parsed.issues }, 400)

      const userId = c.get('userId')
      const sync = c.get('sync')
      if (mode === 'reject' && sync.hasEntities(userId)) {
        return c.json({ error: 'account_not_empty' }, 409)
      }
      try {
        const result = sync.importRecords(userId, parsed.records)
        const total = { created: 0, updated: 0, unchanged: 0 }
        for (const counts of Object.values(result.counts)) {
          total.created += counts.created
          total.updated += counts.updated
          total.unchanged += counts.unchanged
        }
        return c.json({ mode, counts: result.counts, total, seq: result.seq })
      } catch (err) {
        if (err instanceof SyncValidationError) {
          return c.json(
            { error: 'invalid_export', issues: err.problems.flatMap((p) => p.issues).slice(0, 20) },
            400,
          )
        }
        throw err
      }
    },
  )

  return app
}
