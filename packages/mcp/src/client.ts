import {
  type Area,
  applyChange,
  buildSnapshot,
  type Change,
  type ChecklistItem,
  type Clock,
  createClock,
  type Entity,
  type EntityRecord,
  type EntityType,
  entitySchemas,
  type Heading,
  isDeleted,
  clientId as newClientId,
  type Project,
  recordKey,
  type Snapshot,
  type Tag,
  type Task,
  toCalendarDate,
  ulid,
  type Writer,
} from '@dingen/core'

/**
 * A sync client without a UI: the same protocol as the browser (snapshot,
 * pull, push, HLC clock), so Claude is just another device.
 */

export interface SnapshotBody {
  entities: EntityRecord[]
  seq: number
}

export interface PullBody {
  changes: Change[]
  seq: number
  hasMore: boolean
}

/** Where the changes go: the Dingen server over HTTP, or the sync service in-process. */
export interface SyncTransport {
  snapshot(): Promise<SnapshotBody>
  pull(since: number): Promise<PullBody>
  push(changes: Change[]): Promise<unknown>
}

export class HttpTransport implements SyncTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.token}`,
        ...init?.headers,
      },
    })
    if (res.status === 401) throw new Error('Dingen rejected the token (401)')
    if (!res.ok) throw new Error(`Dingen ${path} failed: ${res.status} ${await res.text()}`)
    return res
  }

  async snapshot(): Promise<SnapshotBody> {
    return (await this.request('/api/sync/snapshot')).json() as Promise<SnapshotBody>
  }

  async pull(since: number): Promise<PullBody> {
    return (await this.request(`/api/sync/pull?since=${since}`)).json() as Promise<PullBody>
  }

  async push(changes: Change[]): Promise<unknown> {
    const res = await this.request('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes }),
    })
    return res.json()
  }
}

export interface ClientOptions {
  clientId?: string
  /** The calendar day "now", in the user's timezone. */
  today?: () => string
}

export class DingenClient implements Writer {
  readonly records = new Map<string, EntityRecord>()
  private readonly clock: Clock
  private readonly clientId: string
  private readonly todayFn: () => string
  private cursor = 0
  private loaded = false
  private pending: Change[] = []

  constructor(
    private readonly transport: SyncTransport,
    options: ClientOptions = {},
  ) {
    this.clientId = options.clientId ?? newClientId()
    this.clock = createClock(this.clientId)
    this.todayFn = options.today ?? (() => toCalendarDate())
  }

  get today(): string {
    return this.todayFn()
  }

  /** Loads the replica the first time, then catches up with new changes. */
  async refresh(): Promise<void> {
    if (!this.loaded) {
      const body = await this.transport.snapshot()
      for (const rec of body.entities) {
        this.records.set(recordKey(rec.entityType, rec.id), rec)
        for (const ts of Object.values(rec.fieldTs)) this.clock.receive(ts)
      }
      this.cursor = body.seq
      this.loaded = true
      return
    }
    let hasMore = true
    while (hasMore) {
      const body = await this.transport.pull(this.cursor)
      for (const change of body.changes) {
        this.clock.receive(change.ts)
        const key = recordKey(change.entityType, change.entityId)
        this.records.set(key, applyChange(this.records.get(key), change))
      }
      this.cursor = body.seq
      hasMore = body.hasMore
    }
  }

  /** Sends what was created or mutated since the last flush, in batches the server accepts. */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return
    const all = this.pending
    this.pending = []
    for (let i = 0; i < all.length; i += 500) {
      await this.transport.push(all.slice(i, i + 500))
    }
  }

  entities<T extends Entity>(entityType: EntityType): T[] {
    const schema = entitySchemas[entityType]
    const items: T[] = []
    for (const rec of this.records.values()) {
      if (rec.entityType !== entityType || isDeleted(rec)) continue
      const parsed = schema.safeParse(rec.data)
      if (parsed.success) items.push(parsed.data as T)
    }
    return items
  }

  snapshot(): Snapshot {
    return buildSnapshot(this.today, {
      tasks: this.entities<Task>('task'),
      projects: this.entities<Project>('project'),
      areas: this.entities<Area>('area'),
      headings: this.entities<Heading>('heading'),
      tags: this.entities<Tag>('tag'),
      checklist: this.entities<ChecklistItem>('checklistItem'),
    })
  }

  create(entityType: EntityType, entity: Entity): void {
    const { id, ...fields } = entity
    this.mutate(entityType, id, fields)
  }

  mutate(entityType: EntityType, entityId: string, fields: Record<string, unknown>): void {
    const change: Change = {
      id: ulid(),
      entityType,
      entityId,
      fields,
      ts: this.clock.now(),
      clientId: this.clientId,
    }
    const key = recordKey(entityType, entityId)
    this.records.set(key, applyChange(this.records.get(key), change))
    this.pending.push(change)
  }
}
