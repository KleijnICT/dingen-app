import {
  type ActivityItem,
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
  type Member,
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
import { todayIn } from './time.js'

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

/** Filters of `GET /api/activity`; instants are ISO strings. */
export interface ActivityFilter {
  kinds?: ActivityItem['kind'][] | undefined
  actor?: string | undefined
  since?: string | undefined
  until?: string | undefined
  before?: number | undefined
  limit?: number | undefined
}

export interface ActivityBody {
  items: ActivityItem[]
  nextBefore: number | null
}

/** Where the changes go: the Dingen server over HTTP, or the sync service in-process. */
export interface SyncTransport {
  snapshot(): Promise<SnapshotBody>
  pull(since: number): Promise<PullBody>
  push(changes: Change[]): Promise<unknown>
  /** The activity log (Logbook); absent on transports that have none. */
  activity?(filter: ActivityFilter): Promise<ActivityBody>
  /** The member id of whoever this transport acts as (`agent:<id>` for a token). */
  whoami?(): Promise<string>
  /** The owner and their agents, for assigning. */
  members?(): Promise<Member[]>
  /** When the account was created (ISO instant); the anchor for reviews never done. */
  accountCreatedAt?(): Promise<string | null>
}

/** `?kinds=…&actor=…` for the activity API. */
export function activityQuery(filter: ActivityFilter): string {
  const params = new URLSearchParams()
  if (filter.kinds && filter.kinds.length > 0) params.set('kinds', filter.kinds.join(','))
  if (filter.actor) params.set('actor', filter.actor)
  if (filter.since) params.set('since', filter.since)
  if (filter.until) params.set('until', filter.until)
  if (filter.before !== undefined) params.set('before', String(filter.before))
  if (filter.limit !== undefined) params.set('limit', String(filter.limit))
  const q = params.toString()
  return q ? `?${q}` : ''
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
    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (body.error === 'agent_scope')
        throw new Error(body.message ?? "Outside this agent's scope (403)")
      throw new Error(`Dingen ${path} refused: ${body.error ?? res.status}`)
    }
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

  async activity(filter: ActivityFilter): Promise<ActivityBody> {
    return (
      await this.request(`/api/activity${activityQuery(filter)}`)
    ).json() as Promise<ActivityBody>
  }

  async whoami(): Promise<string> {
    const body = (await (await this.request('/api/auth/me')).json()) as { member?: string }
    if (!body.member) throw new Error('This Dingen server does not know members yet')
    return body.member
  }

  async members(): Promise<Member[]> {
    const body = (await (await this.request('/api/members')).json()) as { members: Member[] }
    return body.members
  }

  async accountCreatedAt(): Promise<string | null> {
    const body = (await (await this.request('/api/auth/me')).json()) as {
      user?: { createdAt?: string }
    }
    return body.user?.createdAt ?? null
  }
}

export interface ClientOptions {
  clientId?: string
  /** The calendar day "now", in the user's timezone. */
  today?: () => string
  /** The user's timezone, for times in readable output. Default: the system's. */
  timezone?: string
}

export class DingenClient implements Writer {
  readonly records = new Map<string, EntityRecord>()
  private readonly clock: Clock
  private readonly clientId: string
  private readonly todayFn: () => string
  readonly timezone: string
  private cursor = 0
  private loaded = false
  private pending: Change[] = []
  private self: string | undefined
  private anchor: string | null | undefined

  constructor(
    private readonly transport: SyncTransport,
    options: ClientOptions = {},
  ) {
    this.clientId = options.clientId ?? newClientId()
    this.clock = createClock(this.clientId)
    this.todayFn = options.today ?? (() => toCalendarDate())
    this.timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  }

  /** The activity log, without touching the replica (an agent with a narrow scope has no sync). */
  async activity(filter: ActivityFilter): Promise<ActivityBody> {
    if (!this.transport.activity) throw new Error('This server has no activity log')
    return this.transport.activity(filter)
  }

  get today(): string {
    return this.todayFn()
  }

  /** The member this client acts as; needed for "me" in assigning and filters. */
  async me(): Promise<string> {
    if (!this.transport.whoami) throw new Error('This connection does not know who "me" is')
    this.self ??= await this.transport.whoami()
    return this.self
  }

  /**
   * The calendar day (in this client's timezone) the account was created: a
   * weekly or monthly review never done counts from there. Null when the
   * transport cannot tell; reviews never done are then due at once.
   */
  async reviewAnchor(): Promise<string | null> {
    if (this.anchor !== undefined) return this.anchor
    const createdAt = await this.transport.accountCreatedAt?.().catch(() => null)
    this.anchor = createdAt ? todayIn(this.timezone, new Date(createdAt)) : null
    return this.anchor
  }

  /** The owner and their agents; empty when the transport cannot tell. */
  async members(): Promise<Member[]> {
    return this.transport.members ? this.transport.members() : []
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
    try {
      for (let i = 0; i < all.length; i += 500) {
        await this.transport.push(all.slice(i, i + 500))
      }
    } catch (err) {
      // The server refused: drop the local edits by loading a fresh replica next time.
      this.records.clear()
      this.loaded = false
      throw err
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
