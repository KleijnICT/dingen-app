import { applyChange, type Change, type EntityRecord, recordKey } from '@dingen/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { DingenClient, type SyncTransport } from './client.js'
import { createMcpServer } from './server.js'

/** The sync protocol in memory: enough to run the tools without a server. */
class MemoryTransport implements SyncTransport {
  readonly records = new Map<string, EntityRecord>()
  readonly log: Change[] = []

  async snapshot() {
    return { entities: [...this.records.values()], seq: this.log.length }
  }

  async pull(since: number) {
    return { changes: this.log.slice(since), seq: this.log.length, hasMore: false }
  }

  async push(changes: Change[]) {
    for (const change of changes) {
      const key = recordKey(change.entityType, change.entityId)
      this.records.set(key, applyChange(this.records.get(key), change))
      this.log.push(change)
    }
    return { seq: this.log.length, applied: changes.length, duplicates: 0 }
  }
}

const TODAY = '2026-11-09'
const transport = new MemoryTransport()
const mcp = new Client({ name: 'test', version: '0' })

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await mcp.callTool({ name, arguments: args })
  const text = (res.content as { type: string; text: string }[])[0]?.text ?? ''
  if (res.isError) throw new Error(text)
  return JSON.parse(text)
}

beforeAll(async () => {
  const server = createMcpServer(new DingenClient(transport, { today: () => TODAY }))
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  await mcp.connect(b)
})

describe('mcp', () => {
  it('starts empty', async () => {
    const o = await call('overview')
    expect(o.counts).toEqual({ inbox: 0, today: 0, upcoming: 0, anytime: 0, someday: 0 })
    expect(o.areas).toEqual([])
  })

  it('captures into the Inbox and refuses unknown tags', async () => {
    const task = await call('create_task', { title: 'Bel de tandarts' })
    expect(task.when).toBe('inbox')
    await expect(call('create_task', { title: 'x', tags: ['nope'] })).rejects.toThrow(/No tag/)
    const inbox = await call('list_tasks', { list: 'inbox' })
    expect(inbox.map((t: { title: string }) => t.title)).toEqual(['Bel de tandarts'])
  })

  it('builds structure and plans a task with a deadline', async () => {
    const area = await call('create_area', { title: 'Werk' })
    const project = await call('create_project', {
      title: 'Website',
      area: 'werk',
      headings: ['Ontwerp'],
    })
    expect(project.area).toBe('Werk')
    expect(project.headings).toHaveLength(1)
    await call('create_tag', { title: 'waiting' })
    const task = await call('create_task', {
      title: 'Offerte sturen',
      project: 'website',
      heading: 'ontwerp',
      when: 'tomorrow',
      deadline: '2026-11-20',
      tags: ['Waiting'],
      checklist: ['Uren tellen', 'Brief schrijven'],
    })
    expect(task).toMatchObject({
      when: '2026-11-10',
      deadline: '2026-11-20',
      project: 'Website',
      heading: 'Ontwerp',
      tags: ['waiting'],
      checklist: '0/2',
    })
    const upcoming = await call('list_tasks', { list: 'upcoming' })
    expect(upcoming).toHaveLength(1)
    const o = await call('overview')
    expect(o.areas[0].id).toBe(area.id)
    expect(o.areas[0].projects[0].openTasks).toBe(1)
  })

  it('updates, moves and completes', async () => {
    const [row] = await call('list_tasks', { project: 'Website' })
    const task = await call('get_task', { id: row.id })
    expect(task.checklistItems).toHaveLength(2)
    const moved = await call('update_task', {
      id: task.id,
      when: 'today',
      area: 'Werk',
      checklist: [{ id: task.checklistItems[0].id, title: 'Alles', done: true }],
    })
    expect(moved.project).toBeUndefined()
    expect(moved.area).toBe('Werk')
    expect(moved.checklist).toBe('1/1')
    expect(moved.checklistItems[0].id).toBe(task.checklistItems[0].id)
    const today = await call('list_tasks', { list: 'today' })
    expect(today.map((t: { id: string }) => t.id)).toEqual([task.id])
    await call('complete_task', { id: task.id })
    const logbook = await call('list_tasks', { list: 'logbook' })
    expect(logbook[0].id).toBe(task.id)
    expect(await call('list_tasks', { list: 'today' })).toEqual([])
  })

  it('repeats after completion', async () => {
    const task = await call('create_task', {
      title: 'Planten water geven',
      when: 'today',
      repeat: { unit: 'day', every: 3, basis: 'completion' },
    })
    expect(task.repeats).toBe('every 3 days after completion')
    await call('complete_task', { id: task.id })
    const upcoming = await call('list_tasks', { list: 'upcoming' })
    expect(upcoming.map((t: { title: string; when: string }) => [t.title, t.when])).toEqual([
      ['Planten water geven', '2026-11-12'],
    ])
    const found = await call('search', { query: 'planten' })
    expect(found.tasks).toHaveLength(1)
  })
})
