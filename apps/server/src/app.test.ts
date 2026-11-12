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
    expect(body).toMatchObject({
      status: 'ok',
      app: 'Dingen',
      version: 'test',
      build: null,
      database: 'ok',
    })
    expect(body.sqliteVersion).toMatch(/^3\./)
  })

  it('geeft JSON 404 voor onbekende API-paden', async () => {
    const res = await app.request('/api/bestaat-niet')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})

describe('mcp', () => {
  it('weigert zonder token, ook met een sessie', async () => {
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'mcp@test.nl', password: 'wachtwoord123' }),
    })
    const cookie = reg.headers.get('set-cookie') ?? ''
    const withCookie = await app.request('/mcp', { method: 'POST', headers: { cookie } })
    expect(withCookie.status).toBe(401)
    const tokenRes = await app.request('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'claude',
        icon: 'bot',
        color: 'gray',
        grants: [{ scope: 'all', level: 'manage' }],
      }),
    })
    const { token } = (await tokenRes.json()) as { token: string }

    const call = (body: unknown) =>
      app.request('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
    const listed = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(listed.status).toBe(200)
    const text = await listed.text()
    expect(text).toContain('create_task')

    const created = await call({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_task', arguments: { title: 'Via MCP' } },
    })
    expect(created.status).toBe(200)
    expect(await created.text()).toMatch(/when.{1,4}:.{1,4}inbox/)

    const snapshot = await app.request('/api/sync/snapshot', {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = (await snapshot.json()) as { entities: { data: { title?: string } }[] }
    expect(body.entities.map((e) => e.data.title)).toEqual(['Via MCP'])
  })
})
