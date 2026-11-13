import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type AgentGrant,
  type Change,
  createClock,
  newArea,
  newChecklistItem,
  newHeading,
  newProject,
  newTag,
  newTask,
  orderBetween,
  ulid,
} from '@dingen/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { migrationsFolder, openDatabase } from './db.js'
import { changes } from './schema.js'

const database = openDatabase(':memory:')
const app = createApp({ db: database.db, version: 'test', sqliteVersion: database.sqliteVersion })
const clock = createClock('SEED')
let lastOrder: string | null = null
const ord = () => {
  lastOrder = orderBetween(lastOrder, null)
  return lastOrder
}

afterAll(() => database.close())

const json = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

let cookie = ''
let ownerId = ''

// The owner's data: two areas, two projects, an inbox task and a tag.
const work = newArea({ title: 'Work', order: ord() })
const home = newArea({ title: 'Home', order: ord() })
const site = newProject({ title: 'Website', areaId: work.id, order: ord() })
const vat = newProject({ title: 'VAT return', areaId: home.id, order: ord() })
const design = newHeading({ title: 'Design', projectId: site.id, order: ord() })
const errands = newTag({ title: 'Errands', order: ord() })
const inboxTask = newTask({ title: 'Loose capture', order: ord() })
const siteTask = newTask({
  title: 'Homepage',
  projectId: site.id,
  when: { kind: 'anytime' },
  order: ord(),
})
const workTask = newTask({
  title: 'Plan the quarter',
  areaId: work.id,
  when: { kind: 'anytime' },
  order: ord(),
})
const vatTask = newTask({
  title: 'Collect receipts',
  projectId: vat.id,
  when: { kind: 'anytime' },
  tagIds: [errands.id],
  order: ord(),
})
const item = newChecklistItem({ title: 'Hero image', taskId: siteTask.id, order: ord() })

function change(entityType: Change['entityType'], entity: { id: string }): Change {
  const { id, ...fields } = entity
  return { id: ulid(), entityType, entityId: id, fields, ts: clock.now(), clientId: 'SEED' }
}

beforeAll(async () => {
  const reg = await app.request(
    '/api/auth/register',
    json('POST', { email: 'owner@example.com', password: 'wachtwoord123' }),
  )
  cookie = reg.headers.get('set-cookie') ?? ''
  ownerId = (await reg.json()).user.id
  const seed = [
    change('area', work),
    change('area', home),
    change('project', site),
    change('project', vat),
    change('heading', design),
    change('tag', errands),
    change('task', inboxTask),
    change('task', siteTask),
    change('task', workTask),
    change('task', vatTask),
    change('checklistItem', item),
  ]
  const res = await app.request('/api/sync/push', json('POST', { changes: seed }, { cookie }))
  expect(res.status).toBe(200)
})

async function makeAgent(name: string, grants: AgentGrant[]) {
  const res = await app.request(
    '/api/agents',
    json('POST', { name, icon: 'bot', color: 'blue', grants }, { cookie }),
  )
  expect(res.status).toBe(201)
  const body = (await res.json()) as { agent: { id: string }; token: string }
  return { id: body.agent.id, token: body.token, member: `agent:${body.agent.id}` }
}

let rpcId = 0
/** Calls an MCP tool as `token`; returns the parsed result or the error text. */
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (res.status !== 200) return { status: res.status, error: await res.text(), data: null }
  const raw = await res.text()
  const line = raw.split('\n').find((l) => l.startsWith('data: '))
  const message = JSON.parse(line ? line.slice(6) : raw)
  const text: string = message.result.content[0].text
  if (message.result.isError) return { status: 200, error: text, data: null }
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  return { status: 200, error: null, data: JSON.parse(text) as any }
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort()

describe('reading within the scope', () => {
  it('inbox: only loose tasks, no area or project titles, tags visible', async () => {
    const agent = await makeAgent('Inbox reader', [{ scope: 'inbox', level: 'read' }])
    const all = await tool(agent.token, 'list_tasks')
    expect(titles(all.data)).toEqual(['Loose capture'])
    const overview = await tool(agent.token, 'overview')
    expect(overview.data.areas).toEqual([])
    expect(overview.data.looseProjects).toEqual([])
    expect(overview.data.tags.map((t: { title: string }) => t.title)).toEqual(['Errands'])
    const search = await tool(agent.token, 'search', { query: 'e' })
    expect(titles(search.data.tasks)).toEqual(['Loose capture'])
    expect(search.data.projects).toEqual([])
  })

  it('project: its tasks, headings and checklist, but not the area title', async () => {
    const agent = await makeAgent('Site', [{ scope: 'project', id: site.id, level: 'read' }])
    const tasks = await tool(agent.token, 'list_tasks')
    expect(titles(tasks.data)).toEqual(['Homepage'])
    const detail = await tool(agent.token, 'get_task', { id: siteTask.id })
    expect(detail.data.checklistItems.map((i: { title: string }) => i.title)).toEqual([
      'Hero image',
    ])
    const overview = await tool(agent.token, 'overview')
    expect(overview.data.areas).toEqual([])
    expect(overview.data.looseProjects).toHaveLength(1)
    expect(overview.data.looseProjects[0].title).toBe('Website')
    expect(overview.data.looseProjects[0].area).toBeUndefined()
    expect(overview.data.looseProjects[0].headings).toEqual([{ id: design.id, title: 'Design' }])
    const other = await tool(agent.token, 'get_task', { id: vatTask.id })
    expect(other.error).toMatch(/No task/)
  })

  it('area: the area, its projects and their tasks', async () => {
    const agent = await makeAgent('Work', [{ scope: 'area', id: work.id, level: 'read' }])
    const tasks = await tool(agent.token, 'list_tasks')
    expect(titles(tasks.data)).toEqual(['Homepage', 'Plan the quarter'])
    const overview = await tool(agent.token, 'overview')
    expect(overview.data.areas.map((a: { title: string }) => a.title)).toEqual(['Work'])
  })

  it('all: everything', async () => {
    const agent = await makeAgent('All', [{ scope: 'all', level: 'read' }])
    const tasks = await tool(agent.token, 'list_tasks')
    expect(tasks.data).toHaveLength(4)
  })

  it('the highest level over matching grants counts', async () => {
    const agent = await makeAgent('Mixed', [
      { scope: 'area', id: work.id, level: 'read' },
      { scope: 'project', id: site.id, level: 'edit' },
    ])
    expect((await tool(agent.token, 'update_task', { id: siteTask.id, notes: 'x' })).error).toBe(
      null,
    )
    const refused = await tool(agent.token, 'update_task', { id: workTask.id, notes: 'x' })
    expect(refused.error).toMatch(/may not change this task \(needs edit\)/)
  })
})

describe('writing within the scope', () => {
  it('read cannot write', async () => {
    const agent = await makeAgent('Reader', [{ scope: 'inbox', level: 'read' }])
    const res = await tool(agent.token, 'complete_task', { id: inboxTask.id })
    expect(res.error).toMatch(/needs edit/)
  })

  it('edit on the inbox: capture yes, into an area no, moving out no', async () => {
    const agent = await makeAgent('Capture', [{ scope: 'inbox', level: 'edit' }])
    const made = await tool(agent.token, 'create_task', { title: 'Captured' })
    expect(made.error).toBe(null)
    const inArea = await tool(agent.token, 'create_task', { title: 'Nope', area: work.id })
    // The area is not even visible to this agent.
    expect(inArea.error).toMatch(/No area/)
    const move = await tool(agent.token, 'update_task', {
      id: made.data.id,
      area: 'Work',
    })
    expect(move.error).toMatch(/No area/)
    const done = await tool(agent.token, 'complete_task', { id: made.data.id })
    expect(done.error).toBe(null)
  })

  it('edit cannot create projects or headings; manage can, within the scope', async () => {
    const editor = await makeAgent('Editor', [{ scope: 'area', id: work.id, level: 'edit' }])
    const project = await tool(editor.token, 'create_project', { title: 'P', area: 'Work' })
    expect(project.error).toMatch(/needs manage/)
    const heading = await tool(editor.token, 'create_heading', { project: site.id, title: 'H' })
    expect(heading.error).toMatch(/needs manage/)
    const task = await tool(editor.token, 'create_task', { title: 'In site', project: site.id })
    expect(task.error).toBe(null)

    const manager = await makeAgent('Manager', [{ scope: 'area', id: work.id, level: 'manage' }])
    const ok = await tool(manager.token, 'create_project', { title: 'Brochure', area: 'Work' })
    expect(ok.error).toBe(null)
    const loose = await tool(manager.token, 'create_project', { title: 'Loose' })
    expect(loose.error).toMatch(/outside this agent's scope/)
    const area = await tool(manager.token, 'create_area', { title: 'New area' })
    expect(area.error).toMatch(/outside this agent's scope/)
  })

  it('moving a task to a place outside the scope is refused', async () => {
    const agent = await makeAgent('Two places', [
      { scope: 'project', id: site.id, level: 'edit' },
      { scope: 'project', id: vat.id, level: 'read' },
    ])
    const task = await tool(agent.token, 'create_task', { title: 'Mover', project: site.id })
    const move = await tool(agent.token, 'update_task', { id: task.data.id, project: vat.id })
    expect(move.error).toMatch(/Moving this task there is outside this agent's scope/)
    const after = await tool(agent.token, 'get_task', { id: task.data.id })
    expect(after.data.projectId).toBe(site.id)
  })
})

describe('sync and account endpoints', () => {
  it('refuses /api/sync without an all grant, and checks writes with one', async () => {
    const scoped = await makeAgent('Scoped', [{ scope: 'inbox', level: 'manage' }])
    const bearer = { authorization: `Bearer ${scoped.token}` }
    for (const p of ['/api/sync/snapshot', '/api/sync/pull?since=0', '/api/export']) {
      const res = await app.request(p, { headers: bearer })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'agent_scope' })
    }

    const reader = await makeAgent('All reader', [{ scope: 'all', level: 'read' }])
    const readBearer = { authorization: `Bearer ${reader.token}` }
    expect((await app.request('/api/sync/snapshot', { headers: readBearer })).status).toBe(200)
    const push = await app.request(
      '/api/sync/push',
      json('POST', { changes: [change('task', newTask({ title: 'x' }))] }, readBearer),
    )
    expect(push.status).toBe(403)
    expect((await push.json()).error).toBe('agent_scope')
  })

  it('calendars: reading needs Everything (read), changing needs Everything (manage)', async () => {
    const reader = await makeAgent('Calendar reader', [{ scope: 'all', level: 'edit' }])
    const bearer = { authorization: `Bearer ${reader.token}` }
    expect((await app.request('/api/calendars', { headers: bearer })).status).toBe(200)
    const add = await app.request(
      '/api/calendars',
      json('POST', { name: 'x', url: 'https://example.com/a.ics' }, bearer),
    )
    expect(add.status).toBe(403)
    expect(
      (await app.request('/api/calendars/nope', { method: 'DELETE', headers: bearer })).status,
    ).toBe(403)
  })
})

describe('agents API', () => {
  it('rotates a token: the old one stops, the new one works', async () => {
    const agent = await makeAgent('Rotor', [{ scope: 'all', level: 'read' }])
    const res = await app.request(`/api/agents/${agent.id}/token`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(res.status).toBe(200)
    const { token, agent: after } = await res.json()
    expect(token).not.toBe(agent.token)
    expect(after.tokenPrefix).toBe(token.slice(0, 10))
    expect((await tool(agent.token, 'overview')).status).toBe(401)
    expect((await tool(token, 'overview')).error).toBe(null)
    // Only a session may rotate.
    const viaToken = await app.request(`/api/agents/${agent.id}/token`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(viaToken.status).toBe(403)
  })

  it('revokes: the token stops, the agent leaves the members, its changes stay attributed', async () => {
    const agent = await makeAgent('Short-lived', [{ scope: 'inbox', level: 'edit' }])
    const made = await tool(agent.token, 'create_task', { title: 'By the short-lived agent' })
    const del = await app.request(`/api/agents/${agent.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(await del.json()).toEqual({ ok: true })
    expect((await tool(agent.token, 'overview')).status).toBe(401)
    const members = await (await app.request('/api/members', { headers: { cookie } })).json()
    expect(members.members.map((m: { id: string }) => m.id)).not.toContain(agent.member)
    const rows = database.db
      .select({ actor: changes.actor })
      .from(changes)
      .where(eq(changes.entityId, made.data.id))
      .all()
    expect(rows.map((r) => r.actor)).toEqual([agent.member])
    const list = await (await app.request('/api/agents', { headers: { cookie } })).json()
    expect(list.agents.map((a: { id: string }) => a.id)).not.toContain(agent.id)
  })

  it('updates name and grants, and validates them', async () => {
    const agent = await makeAgent('Renamed', [{ scope: 'inbox', level: 'read' }])
    const patched = await app.request(
      `/api/agents/${agent.id}`,
      json(
        'PATCH',
        { name: 'Bookkeeper', grants: [{ scope: 'project', id: vat.id, level: 'manage' }] },
        { cookie },
      ),
    )
    const body = await patched.json()
    expect(body.agent.name).toBe('Bookkeeper')
    expect(body.agent.grants).toEqual([{ scope: 'project', id: vat.id, level: 'manage' }])
    expect(titles((await tool(agent.token, 'list_tasks')).data)).toEqual(['Collect receipts'])
    const bad = await app.request(
      `/api/agents/${agent.id}`,
      json('PATCH', { grants: [{ scope: 'area', id: 'nope', level: 'read' }] }, { cookie }),
    )
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_grant')
  })

  it('lists members and who can reach an area or project', async () => {
    const helper = await makeAgent('VAT helper', [{ scope: 'project', id: vat.id, level: 'edit' }])
    const members = await (
      await app.request('/api/members', { headers: { authorization: `Bearer ${helper.token}` } })
    ).json()
    expect(members.members[0]).toEqual({
      id: `user:${ownerId}`,
      kind: 'user',
      name: 'owner@example.com',
      icon: null,
      color: null,
    })
    expect(members.members).toContainEqual({
      id: helper.member,
      kind: 'agent',
      name: 'VAT helper',
      icon: 'bot',
      color: 'blue',
    })

    const access = await (
      await app.request(`/api/access?type=project&id=${vat.id}`, { headers: { cookie } })
    ).json()
    expect(access.members).toContainEqual({ member: `user:${ownerId}`, level: 'manage' })
    expect(access.members).toContainEqual({ member: helper.member, level: 'edit' })
    const area = await (
      await app.request(`/api/access?type=area&id=${home.id}`, { headers: { cookie } })
    ).json()
    expect(area.members.map((m: { member: string }) => m.member)).not.toContain(helper.member)
    // An agent cannot ask about a place it cannot see.
    const hidden = await app.request(`/api/access?type=area&id=${work.id}`, {
      headers: { authorization: `Bearer ${helper.token}` },
    })
    expect(hidden.status).toBe(404)
  })
})

describe('actor and assigning', () => {
  it('records the actor of session pushes, agent writes and imports', async () => {
    const agent = await makeAgent('Actor', [{ scope: 'inbox', level: 'edit' }])
    const made = await tool(agent.token, 'create_task', { title: 'Who made me' })
    const actorOf = (entityId: string) =>
      database.db
        .select({ actor: changes.actor })
        .from(changes)
        .where(eq(changes.entityId, entityId))
        .all()
        .map((r) => r.actor)
    expect(actorOf(made.data.id)).toEqual([agent.member])
    expect(actorOf(inboxTask.id)[0]).toBe(`user:${ownerId}`)

    const exported = await (await app.request('/api/export', { headers: { cookie } })).json()
    const importer = await makeAgent('Importer', [{ scope: 'all', level: 'manage' }])
    const fresh = newTask({ title: 'Imported by agent' })
    const stamp = clock.now()
    exported.entities.task = [
      {
        id: fresh.id,
        data: fresh,
        fieldTs: Object.fromEntries(
          Object.keys(fresh)
            .filter((k) => k !== 'id')
            .map((k) => [k, stamp]),
        ),
      },
    ]
    const res = await app.request(
      '/api/import',
      json('POST', exported, { authorization: `Bearer ${importer.token}` }),
    )
    expect(res.status).toBe(200)
    expect(actorOf(fresh.id)).toEqual([importer.member])
  })

  it('assigns via MCP and filters on it', async () => {
    const agent = await makeAgent('Assignee', [{ scope: 'area', id: work.id, level: 'edit' }])
    const inbox = await makeAgent('Inbox only', [{ scope: 'inbox', level: 'edit' }])

    const mine = await tool(agent.token, 'update_task', { id: workTask.id, assignee: 'me' })
    expect(mine.data.assigneeId).toBe(agent.member)
    const created = await tool(agent.token, 'create_task', {
      title: 'For the owner',
      area: work.id,
      assignee: `user:${ownerId}`,
    })
    expect(created.data.assigneeId).toBe(`user:${ownerId}`)

    const filtered = await tool(agent.token, 'list_tasks', { assigned_to: 'me' })
    expect(titles(filtered.data)).toEqual(['Plan the quarter'])
    expect(filtered.data[0].assigneeId).toBe(agent.member)
    const today = await tool(agent.token, 'list_tasks', { list: 'today', assigned_to: 'me' })
    expect(today.data).toEqual([])

    // The inbox agent cannot see a task in Work, so it cannot be assigned to it.
    const refused = await tool(agent.token, 'update_task', {
      id: workTask.id,
      assignee: inbox.member,
    })
    expect(refused.error).toMatch(/cannot see this task/)
    const unknown = await tool(agent.token, 'update_task', {
      id: workTask.id,
      assignee: 'agent:NOPE',
    })
    expect(unknown.error).toMatch(/No member agent:NOPE/)
    const cleared = await tool(agent.token, 'update_task', { id: workTask.id, assignee: null })
    expect(cleared.data.assigneeId).toBe(null)
  })
})

describe('migration', () => {
  it('turns an existing token into an agent with all/manage that keeps working', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-agents-'))
    try {
      // A migrations folder that stops before 0006, like the previous build.
      const before = path.join(dir, 'migrations')
      fs.cpSync(migrationsFolder, before, { recursive: true })
      const journalPath = path.join(before, 'meta/_journal.json')
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
      // Drop 0006 and everything after it: drizzle skips a migration older than the last applied one.
      journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0006')
      fs.writeFileSync(journalPath, JSON.stringify(journal))

      const file = path.join(dir, 'dingen.db')
      const old = openDatabase(file, { migrationsFolder: before })
      const secret = `dgn_${'x'.repeat(43)}`
      const { createHash } = await import('node:crypto')
      old.sqlite.exec(
        `insert into users (id, email, password_hash, created_at, is_admin) values ('U1', 'old@example.com', 'x', '2026-01-01T00:00:00.000Z', 1);
         insert into api_tokens (id, user_id, name, prefix, token_hash, created_at) values ('T1', 'U1', 'Claude Code', 'dgn_xxxxxx', '${createHash('sha256').update(secret).digest('hex')}', '2026-01-01T00:00:00.000Z');`,
      )
      old.close()

      const upgraded = openDatabase(file)
      try {
        const next = createApp({
          db: upgraded.db,
          version: 'test',
          sqliteVersion: upgraded.sqliteVersion,
        })
        const bearer = { authorization: `Bearer ${secret}` }
        const me = await (await next.request('/api/auth/me', { headers: bearer })).json()
        expect(me.member).toBe('agent:T1')
        const push = await next.request(
          '/api/sync/push',
          json('POST', { changes: [change('task', newTask({ title: 'Still works' }))] }, bearer),
        )
        expect(push.status).toBe(200)
        const snap = await (await next.request('/api/sync/snapshot', { headers: bearer })).json()
        expect(snap.entities).toHaveLength(1)
        const members = await (await next.request('/api/members', { headers: bearer })).json()
        expect(members.members[1]).toEqual({
          id: 'agent:T1',
          kind: 'agent',
          name: 'Claude Code',
          icon: 'bot',
          color: 'gray',
        })
        const actor = upgraded.sqlite.prepare('select actor from changes').get() as {
          actor: string
        }
        expect(actor.actor).toBe('agent:T1')
      } finally {
        upgraded.close()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
