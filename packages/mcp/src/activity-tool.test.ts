import type { ActivityItem, Member } from '@dingen/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { formatActivity, instant, resolveWho } from './activity-tool.js'
import { type ActivityFilter, activityQuery, DingenClient, type SyncTransport } from './client.js'
import { createMcpServer } from './server.js'

const members: Member[] = [
  { id: 'user:U1', kind: 'user', name: 'sam@example.com', icon: null, color: null },
  { id: 'agent:A1', kind: 'agent', name: 'Research', icon: 'bot', color: 'blue' },
]

const items: ActivityItem[] = [
  {
    seq: 9,
    at: '2026-11-12T13:05:00.000Z',
    actor: 'agent:A1',
    kind: 'updated',
    entityType: 'task',
    entityId: 'T1',
    title: 'Write report',
    container: { type: 'project', id: 'P1', title: 'Q4' },
    fields: [
      { field: 'when', from: { kind: 'date', date: '2026-11-12' }, to: { kind: 'someday' } },
      { field: 'notes', from: null, to: null },
    ],
  },
  {
    seq: 4,
    at: '2026-11-11T08:00:00.000Z',
    actor: 'user:U1',
    kind: 'completed',
    entityType: 'task',
    entityId: 'T2',
    title: 'Call the bank',
    container: null,
    fields: [{ field: 'status', from: null, to: 'completed' }],
  },
]

describe('formatActivity', () => {
  it('writes readable lines per day, with names and ids', () => {
    const text = formatActivity(items, { members, timezone: 'Europe/Amsterdam' })
    expect(text).toBe(
      [
        '2026-11-12',
        '  14:05  Research changed when from 2026-11-12 to someday; notes of task "Write report" [T1] (project "Q4")',
        '',
        '2026-11-11',
        '  09:00  you completed task "Call the bank" [T2]',
      ].join('\n'),
    )
    expect(formatActivity([], { members, timezone: 'UTC' })).toBe('No activity found.')
  })
})

describe('filters', () => {
  it('resolves who by name, me or id', () => {
    expect(resolveWho('research', members)).toBe('agent:A1')
    expect(resolveWho('me', members)).toBe('user:U1')
    expect(resolveWho('agent:ZZ', members)).toBe('agent:ZZ')
    expect(() => resolveWho('nobody', members)).toThrow(/known: sam@example.com, Research/)
  })

  it('turns days into instants in the timezone', () => {
    const tz = 'Europe/Amsterdam'
    expect(instant('today', '2026-11-12', tz, 'start')).toBe('2026-11-11T23:00:00.000Z')
    expect(instant('yesterday', '2026-11-12', tz, 'end')).toBe('2026-11-11T22:59:59.999Z')
    // Summer time.
    expect(instant('2026-07-01', '2026-11-12', tz, 'start')).toBe('2026-06-30T22:00:00.000Z')
    expect(instant('2026-11-12T10:00:00Z', '2026-11-12', tz, 'start')).toBe(
      '2026-11-12T10:00:00.000Z',
    )
    expect(() => instant('soon', '2026-11-12', tz, 'start')).toThrow(/Not a date/)
  })

  it('builds the query string of the API', () => {
    expect(activityQuery({})).toBe('')
    expect(
      activityQuery({ kinds: ['added', 'deleted'], actor: 'agent:A1', before: 5, limit: 3 }),
    ).toBe('?kinds=added%2Cdeleted&actor=agent%3AA1&before=5&limit=3')
  })
})

describe('get_activity', () => {
  const seen: ActivityFilter[] = []
  const transport: SyncTransport = {
    snapshot: async () => {
      throw new Error('get_activity must not load the replica')
    },
    pull: async () => {
      throw new Error('get_activity must not pull')
    },
    push: async () => ({}),
    activity: async (filter) => {
      seen.push(filter)
      return { items, nextBefore: 4 }
    },
    members: async () => members,
  }
  const mcp = new Client({ name: 'test', version: '0' })

  beforeAll(async () => {
    const server = createMcpServer(
      new DingenClient(transport, { today: () => '2026-11-12', timezone: 'Europe/Amsterdam' }),
    )
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    await mcp.connect(b)
  })

  it('passes the filters on and says how to get more', async () => {
    const res = await mcp.callTool({
      name: 'get_activity',
      arguments: { who: 'Research', since: 'yesterday', kinds: ['updated'] },
    })
    const text = (res.content as { text: string }[])[0]?.text ?? ''
    expect(res.isError).toBeFalsy()
    expect(text).toContain('Research changed when')
    expect(text).toContain('before=4')
    expect(seen[0]).toMatchObject({
      actor: 'agent:A1',
      kinds: ['updated'],
      since: '2026-11-10T23:00:00.000Z',
      limit: 30,
    })
  })
})
