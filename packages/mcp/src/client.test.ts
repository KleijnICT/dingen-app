import {
  applyChange,
  type Change,
  createClock,
  type EntityRecord,
  newTask,
  type PullResponse,
  type PullSpace,
  recordKey,
  type SpaceCursor,
  type SpaceInfo,
  type Task,
  ulid,
} from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { DingenClient, HttpTransport, type SyncTransport } from './client.js'

const PERSONAL = 'P'
const other = createClock('OTHER')

function createdBy(entity: { id: string }): Change {
  const { id, ...fields } = entity
  return { id: ulid(), entityType: 'task', entityId: id, fields, ts: other.now(), clientId: 'X' }
}

/** A protocol 2 server in memory, with spaces. */
class SpaceTransport implements SyncTransport {
  log: { seq: number; spaceId: string; change: Change }[] = []
  records = new Map<string, EntityRecord>()
  spaceOf = new Map<string, string>()
  spaces: SpaceInfo[] = [{ id: PERSONAL, kind: 'personal', level: 'manage' }]
  pulled: Change[] = []
  cursors: SpaceCursor[] = []

  write(change: Change, spaceId = PERSONAL) {
    const key = recordKey(change.entityType, change.entityId)
    const space = this.spaceOf.get(key) ?? spaceId
    this.log.push({ seq: this.log.length + 1, spaceId: space, change })
    this.spaceOf.set(key, space)
    this.records.set(key, applyChange(this.records.get(key), change))
  }

  private seqOf(space: string) {
    return this.log.filter((l) => l.spaceId === space).at(-1)?.seq ?? 0
  }

  private live(space: string) {
    return [...this.records].filter(([k]) => this.spaceOf.get(k) === space).map(([, r]) => r)
  }

  async snapshot() {
    return {
      entities: this.spaces.flatMap((s) => this.live(s.id).map((r) => ({ ...r, spaceId: s.id }))),
      seq: this.log.length,
      cursor: Object.fromEntries(this.spaces.map((s) => [s.id, this.seqOf(s.id)])),
      spaces: this.spaces,
    }
  }

  async pull(): Promise<never> {
    throw new Error('protocol 1 pull must not be used')
  }

  async pullSpaces(cursor: SpaceCursor): Promise<PullResponse> {
    this.cursors.push(cursor)
    const out: PullSpace[] = this.spaces.map((space) => {
      const since = cursor[space.id]
      if (since === undefined) {
        return {
          ...space,
          seq: this.seqOf(space.id),
          changes: [],
          entities: this.live(space.id),
          hasMore: false,
        }
      }
      const page = this.log.filter((l) => l.spaceId === space.id && l.seq > since)
      this.pulled.push(...page.map((l) => l.change))
      return {
        ...space,
        seq: page.at(-1)?.seq ?? since,
        changes: page.map((l) => l.change),
        hasMore: false,
      }
    })
    return {
      protocol: 2,
      spaces: out,
      removed: Object.keys(cursor).filter((id) => !this.spaces.some((s) => s.id === id)),
      cursor: Object.fromEntries(out.map((s) => [s.id, s.seq])),
      hasMore: false,
    }
  }

  async push(changes: Change[], cursor?: SpaceCursor) {
    const before = this.log.length
    for (const change of changes) this.write(change)
    const mine = this.log.slice(before)
    const advanced: SpaceCursor = {}
    for (const space of new Set(mine.map((l) => l.spaceId))) {
      const since = cursor?.[space]
      if (since === undefined) continue
      const after = this.log.filter((l) => l.spaceId === space && l.seq > since)
      if (after.every((l) => mine.includes(l))) advanced[space] = this.seqOf(space)
    }
    return { seq: this.log.length, applied: changes.length, duplicates: 0, cursor: advanced }
  }
}

const titles = (client: DingenClient) =>
  client
    .entities<Task>('task')
    .map((t) => t.title)
    .sort()

describe('DingenClient with a cursor per space', () => {
  it('follows spaces: changes per space, a new space as snapshot, a left space dropped', async () => {
    const transport = new SpaceTransport()
    transport.write(createdBy(newTask({ title: 'Own' })))
    const client = new DingenClient(transport)
    await client.refresh()
    expect(titles(client)).toEqual(['Own'])

    // Shared with us, with history.
    transport.write(createdBy(newTask({ title: 'Shared' })), 'S')
    transport.spaces.push({ id: 'S', kind: 'shared', level: 'edit' })
    transport.write(createdBy(newTask({ title: 'Own 2' })))
    await client.refresh()
    expect(transport.cursors.at(-1)).toEqual({ [PERSONAL]: 1 })
    expect(titles(client)).toEqual(['Own', 'Own 2', 'Shared'])
    expect(transport.pulled.map((c) => c.fields.title)).toEqual(['Own 2'])

    // Left it again.
    transport.spaces = transport.spaces.filter((s) => s.id !== 'S')
    await client.refresh()
    expect(transport.cursors.at(-1)).toEqual({ [PERSONAL]: 3, S: 2 })
    expect(titles(client)).toEqual(['Own', 'Own 2'])
  })

  it('sends its cursor with a push and does not pull its own changes back', async () => {
    const transport = new SpaceTransport()
    const client = new DingenClient(transport)
    await client.refresh()
    client.create('task', newTask({ title: 'Mine' }))
    await client.flush()
    await client.refresh()
    expect(transport.pulled).toEqual([])
    expect(transport.cursors.at(-1)).toEqual({ [PERSONAL]: 1 })
    expect(titles(client)).toEqual(['Mine'])
  })

  it('falls back to protocol 1 when the server sends no cursor per space', async () => {
    const log: Change[] = []
    const seen: number[] = []
    const transport: SyncTransport = {
      snapshot: async () => ({ entities: [], seq: 0 }),
      pull: async (since) => {
        seen.push(since)
        return { changes: log.slice(since), seq: log.length, hasMore: false }
      },
      pullSpaces: async () => {
        throw new Error('this server speaks protocol 1')
      },
      push: async () => ({ seq: 0 }),
    }
    const client = new DingenClient(transport)
    await client.refresh()
    log.push(createdBy(newTask({ title: 'Old server' })))
    await client.refresh()
    expect(seen).toEqual([0])
    expect(titles(client)).toEqual(['Old server'])
  })
})

describe('HttpTransport', () => {
  it('sends the cursor per space as URL-encoded JSON and with a push', async () => {
    const calls: { url: string; body?: string }[] = []
    const transport = new HttpTransport('https://dingen.example/', 'tok', async (input, init) => {
      calls.push({ url: String(input), body: init?.body as string | undefined })
      return new Response('{}', { status: 200 })
    })
    await transport.pullSpaces({ 'A B': 3 })
    await transport.push([], { P: 1 })
    await transport.push([])
    expect(calls[0]?.url).toBe(
      `https://dingen.example/api/sync/pull?cursor=${encodeURIComponent('{"A B":3}')}`,
    )
    expect(JSON.parse(calls[1]?.body ?? '')).toEqual({ changes: [], cursor: { P: 1 } })
    expect(JSON.parse(calls[2]?.body ?? '')).toEqual({ changes: [] })
  })
})
