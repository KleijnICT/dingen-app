import {
  applyChange,
  type Change,
  ClientOutdatedError,
  clientOutdatedBody,
  createClock,
  type EntityRecord,
  newTask,
  type Placed,
  PROTOCOL_HEADER,
  type PullResponse,
  type PullSpace,
  recordKey,
  type SpaceCursor,
  type SpaceInfo,
  SYNC_PROTOCOL,
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

/** A server in memory, with spaces. */
class SpaceTransport implements SyncTransport {
  log: { seq: number; spaceId: string; change: Change }[] = []
  records = new Map<string, EntityRecord>()
  spaceOf = new Map<string, string>()
  spaces: SpaceInfo[] = [{ id: PERSONAL, kind: 'personal', level: 'manage' }]
  pulled: Change[] = []
  cursors: SpaceCursor[] = []
  /** Moves for the next pull per space, and the next push answer's `placed`. */
  moves = new Map<string, Pick<PullSpace, 'arrived' | 'left'>>()
  placed: Placed[] | undefined

  write(change: Change, spaceId = PERSONAL) {
    const key = recordKey(change.entityType, change.entityId)
    const space = this.spaceOf.get(key) ?? spaceId
    this.log.push({ seq: this.log.length + 1, spaceId: space, change })
    this.spaceOf.set(key, space)
    this.records.set(key, applyChange(this.records.get(key), change))
  }

  /** Back to the first `count` log entries, as a restored backup. */
  restoreTo(count: number) {
    const log = this.log.slice(0, count)
    this.log = []
    this.records.clear()
    this.spaceOf.clear()
    for (const entry of log) this.write(entry.change, entry.spaceId)
  }

  private seqOf(space: string) {
    return this.log.filter((l) => l.spaceId === space).at(-1)?.seq ?? 0
  }

  private live(space: string) {
    return [...this.records].filter(([k]) => this.spaceOf.get(k) === space).map(([, r]) => r)
  }

  async snapshot() {
    return {
      protocol: SYNC_PROTOCOL,
      entities: this.spaces.flatMap((s) => this.live(s.id).map((r) => ({ ...r, spaceId: s.id }))),
      cursor: Object.fromEntries(this.spaces.map((s) => [s.id, this.seqOf(s.id)])),
      spaces: this.spaces,
    }
  }

  async pullSpaces(cursor: SpaceCursor): Promise<PullResponse> {
    this.cursors.push(cursor)
    const out: PullSpace[] = this.spaces.map((space) => {
      const since = cursor[space.id]
      // A cursor beyond the log (the server was restored): the space again, marked resync.
      const ahead = since !== undefined && since > this.seqOf(space.id)
      if (since === undefined || ahead) {
        return {
          ...space,
          seq: this.seqOf(space.id),
          changes: [],
          entities: this.live(space.id),
          hasMore: false,
          ...(ahead ? { resync: true as const } : {}),
        }
      }
      const page = this.log.filter((l) => l.spaceId === space.id && l.seq > since)
      this.pulled.push(...page.map((l) => l.change))
      const moves = this.moves.get(space.id)
      this.moves.delete(space.id)
      return {
        ...space,
        seq: page.at(-1)?.seq ?? since,
        changes: page.map((l) => l.change),
        ...moves,
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
    const placed = this.placed
    this.placed = undefined
    return {
      applied: changes.length,
      duplicates: 0,
      cursor: advanced,
      ...(placed ? { placed } : {}),
    }
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

  it('applies moves: an arrival takes its new space, a leave drops it, a push answer places', async () => {
    const transport = new SpaceTransport()
    transport.spaces.push({ id: 'S', kind: 'shared', level: 'edit' })
    const task = newTask({ title: 'Moving' })
    transport.write(createdBy(task))
    const client = new DingenClient(transport)
    await client.refresh()
    expect(client.spaceIdOf('task', task.id)).toBe(PERSONAL)

    // Moved to S by someone else: the whole record arrives there; an older edit in the
    // personal stream of the same answer does not keep it there.
    transport.write({ ...createdBy(task), fields: { notes: 'edited first' } })
    const record = transport.records.get(recordKey('task', task.id)) as EntityRecord
    transport.moves.set('S', {
      arrived: [{ ...record, data: { ...record.data, title: 'Moved' } }],
    })
    await client.refresh()
    expect(titles(client)).toEqual(['Moved'])
    expect(client.spaceIdOf('task', task.id)).toBe('S')

    // Out of sight now: dropped.
    transport.moves.set('S', { left: [{ entityType: 'task', id: task.id }] })
    await client.refresh()
    expect(titles(client)).toEqual([])
    expect(client.spaceIdOf('task', task.id)).toBeUndefined()

    // Our own push: the answer says where a new task landed.
    const mine = newTask({ title: 'Mine' })
    client.create('task', mine)
    transport.placed = [{ entityType: 'task', id: mine.id, spaceId: 'S' }]
    await client.flush()
    expect(client.spaceIdOf('task', mine.id)).toBe('S')
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

  it('loads a space again after a restore, keeping changes not flushed yet', async () => {
    const transport = new SpaceTransport()
    const kept = newTask({ title: 'Kept' })
    transport.write(createdBy(kept))
    transport.write(createdBy(newTask({ title: 'Lost' })))
    const client = new DingenClient(transport)
    await client.refresh()
    expect(titles(client)).toEqual(['Kept', 'Lost'])

    transport.restoreTo(1)
    client.mutate('task', kept.id, { title: 'Kept, edited' })
    await client.refresh()
    expect(titles(client)).toEqual(['Kept, edited'])
    await client.flush()
    expect(transport.records.get(recordKey('task', kept.id))?.data.title).toBe('Kept, edited')
    await client.refresh()
    expect(titles(client)).toEqual(['Kept, edited'])
  })
})

describe('HttpTransport', () => {
  it('names its protocol on every request', async () => {
    const headers: (string | null)[] = []
    const transport = new HttpTransport('https://dingen.example', 'tok', async (_input, init) => {
      headers.push(new Headers(init?.headers).get(PROTOCOL_HEADER))
      return Response.json({ protocol: SYNC_PROTOCOL, entities: [], spaces: [], cursor: {} })
    })
    await transport.snapshot()
    await transport.pullSpaces({})
    expect(headers).toEqual([String(SYNC_PROTOCOL), String(SYNC_PROTOCOL)])
  })

  it('turns 426 client_outdated into a ClientOutdatedError that says to update the plugin', async () => {
    const transport = new HttpTransport('https://dingen.example', 'tok', async () =>
      Response.json(clientOutdatedBody(4), { status: 426 }),
    )
    const err = await transport.snapshot().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClientOutdatedError)
    expect((err as Error).message).toMatch(/update the plugin/)
  })

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
