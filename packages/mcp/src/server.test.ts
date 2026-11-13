import {
  addDays,
  applyChange,
  type Change,
  dateOf,
  type EntityRecord,
  newReview,
  recordKey,
} from '@dingen/core'
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

  it('creates an area with icon and colour and rejects unknown ids', async () => {
    const area = await call('create_area', { title: 'Huis', icon: 'home', color: 'green' })
    expect(area).toMatchObject({ icon: 'home', color: 'green' })
    const o = await call('overview', {})
    expect(o.areas.find((x: { id: string }) => x.id === area.id)).toMatchObject({
      icon: 'home',
      color: 'green',
    })
    await expect(call('create_area', { title: 'x', icon: 'nope' })).rejects.toThrow()
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

describe('mcp reviews', () => {
  const store = new MemoryTransport()
  const claude = new Client({ name: 'test-review', version: '0' })

  async function rcall(name: string, args: Record<string, unknown> = {}) {
    const res = await claude.callTool({ name, arguments: args })
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? ''
    if (res.isError) throw new Error(text)
    return JSON.parse(text)
  }

  beforeAll(async () => {
    const server = createMcpServer(new DingenClient(store, { today: () => TODAY }))
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    await claude.connect(b)
  })

  it('shows every review as due when there never was one', async () => {
    const r = await rcall('get_review')
    expect(r.due).toEqual(['daily', 'weekly', 'monthly'])
    expect(r.reviews.map((x: { running: unknown }) => x.running)).toEqual([null, null, null])
    await expect(
      rcall('complete_review_step', { kind: 'weekly', step: 'mindSweep' }),
    ).rejects.toThrow(/start_review/)
  })

  it('starts a weekly review once and resumes it', async () => {
    const first = await rcall('start_review', { kind: 'weekly' })
    expect(first.resumed).toBe(false)
    expect(first.currentStep).toBe('mindSweep')
    expect(first.items).toEqual({ kind: 'none' })
    const again = await rcall('start_review', { kind: 'weekly' })
    expect(again).toMatchObject({ resumed: true, id: first.id })
  })

  it('ticks steps; the Inbox step only by emptying the Inbox', async () => {
    const task = await rcall('create_task', { title: 'Lamp vervangen' })
    const ticked = await rcall('complete_review_step', { kind: 'weekly', step: 'mindSweep' })
    expect(ticked.currentStep).toBe('inbox')
    expect(ticked.items.tasks.map((t: { title: string }) => t.title)).toEqual(['Lamp vervangen'])
    await expect(rcall('complete_review_step', { kind: 'weekly', step: 'inbox' })).rejects.toThrow(
      /Inbox is empty/,
    )
    await expect(rcall('complete_review_step', { kind: 'weekly', step: 'nope' })).rejects.toThrow(
      /No step/,
    )
    await rcall('update_task', { id: task.id, when: 'anytime' })
    const r = await rcall('get_review', { kind: 'weekly' })
    expect(r.reviews[0].running.currentStep).toBe('weekLookBack')
    await rcall('complete_review_step', { kind: 'weekly', step: 'weekLookBack' })
    const due = await rcall('complete_review_step', { kind: 'weekly', step: 'dueSoon' })
    // No projects or areas yet: those steps are done by an empty list.
    expect(due.currentStep).toBe('looseTasks')
  })

  it('shows projects with signals and ticks them off one by one', async () => {
    const area = await rcall('create_area', { title: 'Thuis' })
    const project = await rcall('create_project', { title: 'Zolder opruimen', area: area.id })
    expect(project).toMatchObject({ reviewedAt: null, signals: ['noNextAction'] })
    const r = await rcall('get_review', { kind: 'weekly' })
    const items = r.reviews[0].running.items
    expect(items.kind).toBe('projects')
    expect(items.projects).toEqual([
      expect.objectContaining({ id: project.id, reviewed: false, signals: ['noNextAction'] }),
    ])
    await expect(rcall('mark_reviewed', {})).rejects.toThrow(/exactly one/)
    await expect(rcall('mark_reviewed', { project: project.id, area: area.id })).rejects.toThrow(
      /exactly one/,
    )
    const marked = await rcall('mark_reviewed', { project: 'zolder opruimen' })
    expect(marked.reviewed.project).toBe(project.id)
    const after = await rcall('get_review', { kind: 'weekly' })
    expect(after.reviews[0].running.currentStep).toBe('areas')
    expect(after.reviews[0].running.items.areas[0]).toMatchObject({
      id: area.id,
      reviewed: false,
      projects: ['Zolder opruimen'],
    })
    const o = await rcall('overview')
    expect(o.areas[0]).toMatchObject({ id: area.id, reviewedAt: null })
    expect(o.areas[0].projects[0].reviewedAt).toBe(marked.reviewedAt)
  })

  it('refuses to complete with open steps, then completes', async () => {
    await expect(rcall('complete_review', { kind: 'weekly' })).rejects.toThrow(/Steps still open/)
    await rcall('mark_reviewed', { area: 'Thuis' })
    for (const step of ['looseTasks', 'somedayScan', 'triggers']) {
      await rcall('complete_review_step', { kind: 'weekly', step })
    }
    const r = await rcall('get_review', { kind: 'weekly' })
    expect(r.reviews[0].running.currentStep).toBeNull()
    const done = await rcall('complete_review', { kind: 'weekly' })
    expect(done.skippedSteps).toEqual([])
    expect(done.nextDue).toBe(addDays(dateOf(done.completedAt), 7))
    const after = await rcall('get_review')
    expect(after.due).not.toContain('weekly')
    expect(after.reviews[1]).toMatchObject({ kind: 'weekly', running: null })
  })

  it('ticks Someday groups in the monthly review', async () => {
    await rcall('create_task', { title: 'Italiaans leren', when: 'someday', area: 'Thuis' })
    await rcall('start_review', { kind: 'monthly' })
    await expect(
      rcall('complete_review_step', { kind: 'monthly', step: 'somedayDeep', group: 'elders' }),
    ).rejects.toThrow(/No Someday group/)
    const r = await rcall('get_review', { kind: 'monthly', step: 'somedayDeep' })
    const group = r.reviews[0].running.items.groups[0]
    expect(group).toMatchObject({ area: 'Thuis', done: false })
    const ticked = await rcall('complete_review_step', {
      kind: 'monthly',
      step: 'somedayDeep',
      group: group.group,
    })
    expect(ticked.ticked).toBe(`somedayDeep:${group.group}`)
    const forced = await rcall('complete_review', { kind: 'monthly', force: true })
    expect(forced.skippedSteps).toEqual(['monthLookBack', 'areasDeep'])
  })

  it('resumes a review started on another device', async () => {
    const app = new DingenClient(store, { today: () => TODAY })
    await app.refresh()
    const review = newReview({ kind: 'daily' })
    app.create('review', review)
    await app.flush()
    const resumed = await rcall('start_review', { kind: 'daily' })
    expect(resumed).toMatchObject({ resumed: true, id: review.id, currentStep: null })
  })
})

describe('mcp reviews for a new account', () => {
  class AnchoredTransport extends MemoryTransport {
    async accountCreatedAt() {
      return `${TODAY}T10:00:00.000Z`
    }
  }
  let today = TODAY
  const claude = new Client({ name: 'test-anchor', version: '0' })

  async function rcall(name: string, args: Record<string, unknown> = {}) {
    const res = await claude.callTool({ name, arguments: args })
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? ''
    if (res.isError) throw new Error(text)
    return JSON.parse(text)
  }

  beforeAll(async () => {
    const client = new DingenClient(new AnchoredTransport(), {
      today: () => today,
      timezone: 'UTC',
    })
    const server = createMcpServer(client)
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    await claude.connect(b)
  })

  it('has no weekly or monthly review due on the day the account was created', async () => {
    const r = await rcall('get_review')
    expect(r.due).toEqual(['daily'])
    expect(r.reviews.map((x: { nextDue: string }) => x.nextDue)).toEqual([
      TODAY,
      addDays(TODAY, 7),
      '2026-12-09',
    ])
  })

  it('makes the weekly review due a week later, the monthly a month later', async () => {
    today = addDays(TODAY, 7)
    expect((await rcall('get_review')).due).toEqual(['daily', 'weekly'])
    today = '2026-12-09'
    expect((await rcall('get_review')).due).toEqual(['daily', 'weekly', 'monthly'])
  })

  it('still lets a review start before it is due', async () => {
    today = TODAY
    const started = await rcall('start_review', { kind: 'monthly' })
    expect(started.resumed).toBe(false)
    expect((await rcall('get_review')).due).toEqual(['daily', 'monthly'])
  })
})
