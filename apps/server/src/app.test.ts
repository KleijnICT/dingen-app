import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

const database = openDatabase(':memory:')
const app = createApp({ db: database.db, version: 'test', sqliteVersion: database.sqliteVersion })

afterAll(() => database.close())

describe('server', () => {
  it('meldt gezondheid met databasestatus', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'ok', app: 'Dingen', version: 'test', database: 'ok' })
    expect(body.sqliteVersion).toMatch(/^3\./)
  })

  it('geeft JSON 404 voor onbekende API-paden', async () => {
    const res = await app.request('/api/bestaat-niet')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})
