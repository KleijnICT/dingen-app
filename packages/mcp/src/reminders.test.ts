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

// --- herinneringen ---
describe('time and reminder', () => {
  it('a time also sets a reminder at that time', async () => {
    const task = await call('create_task', {
      title: 'Bel de huisarts',
      when: 'tomorrow',
      time: '08:00',
    })
    expect(task.time).toBe('08:00')
    expect(task.reminder).toBe('2026-11-10 08:00')
  })

  it('takes a reminder on an earlier day, or none', async () => {
    const task = await call('create_task', {
      title: 'Container buiten zetten',
      when: '2026-11-12',
      time: '07:00',
      reminder: '2026-11-11 20:00',
    })
    expect(task.reminder).toBe('2026-11-11 20:00')
    const quiet = await call('create_task', {
      title: 'Lunch',
      when: 'today',
      time: '12:30',
      reminder: null,
    })
    expect(quiet.time).toBe('12:30')
    expect(quiet.reminder).toBeUndefined()
  })

  it('refuses a time without a date and a reminder after the date', async () => {
    await expect(call('create_task', { title: 'x', time: '09:00' })).rejects.toThrow(/needs a date/)
    await expect(
      call('create_task', { title: 'x', when: 'today', reminder: '2026-11-10 09:00' }),
    ).rejects.toThrow(/after/)
    await expect(
      call('create_task', { title: 'x', when: 'today', time: '25:00' }),
    ).rejects.toThrow()
  })

  it('update_task moves a following reminder with the time and clears both without a date', async () => {
    const task = await call('create_task', { title: 'Overleg', when: 'today', time: '10:00' })
    const moved = await call('update_task', { id: task.id, time: '11:00' })
    expect(moved.reminder).toBe('2026-11-09 11:00')
    const later = await call('update_task', { id: task.id, when: '2026-11-13' })
    expect([later.time, later.reminder]).toEqual(['11:00', '2026-11-13 11:00'])
    const off = await call('update_task', { id: task.id, reminder: null })
    expect(off.reminder).toBeUndefined()
    const someday = await call('update_task', { id: task.id, time: '09:00', reminder: '09:00' })
    expect(someday.reminder).toBe('2026-11-13 09:00')
    const cleared = await call('update_task', { id: task.id, when: 'someday' })
    expect([cleared.time, cleared.reminder]).toEqual([undefined, undefined])
  })

  it('a repeating task keeps time and reminder for the next occurrence', async () => {
    const task = await call('create_task', {
      title: 'Medicijnen',
      when: 'today',
      time: '08:00',
      repeat: { unit: 'day' },
    })
    await call('complete_task', { id: task.id })
    const upcoming = await call('list_tasks', { list: 'upcoming' })
    const next = upcoming.find((t: { title: string }) => t.title === 'Medicijnen')
    expect(next).toMatchObject({ when: '2026-11-10', time: '08:00', reminder: '2026-11-10 08:00' })
  })
})
