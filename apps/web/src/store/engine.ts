import {
  applyChange,
  type Change,
  type Clock,
  createClock,
  type Entity,
  type EntityType,
  entitySchemas,
  isDeleted,
  mergeCursor,
  clientId as newClientId,
  type PullResponse,
  type PushResponse,
  recordKey,
  SPACE_FIELD,
  type SpaceCursor,
  ulid,
} from '@dingen/core'
import { withBase } from '../base.js'
import { dbNameFor, LocalDb, type LocalRecord, type StoredRecord } from './db.js'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unauthorized'

export interface EngineOptions {
  userId: string
  /** Vervangbaar in tests. */
  fetchFn?: typeof fetch
  dbName?: string
  pollIntervalMs?: number
  pushDelayMs?: number
}

/**
 * De sync-engine van de browser: lokale replica, outbox, push en pull.
 * Zelfde protocol als straks de native clients, bewust zonder slimmigheden.
 *
 * Sync protocol 2: a cursor per space. A first pull with an empty cursor gets
 * every space as a snapshot; a space shared later arrives the same way, and
 * a space the user leaves is dropped. A replica from before protocol 2 keeps
 * its single cursor once: the server answers a numeric cursor for all spaces
 * and the engine stores the cursor per space from then on.
 *
 * Moving between spaces (plan 23, part 3): a pull lists per space what
 * `arrived` (the whole record, now in that space) and what `left` (out of
 * sight: dropped); a push answer says where new and moved entities landed.
 */
export class SyncEngine {
  readonly records = new Map<string, LocalRecord>()
  /** Loopt op bij elke verandering; React gebruikt dit als snapshot. */
  version = 0
  status: SyncStatus = 'idle'
  /** True once the local replica is loaded and the first sync has been attempted. */
  ready = false
  onUnauthorized: (() => void) | undefined

  private readonly db: LocalDb
  private readonly fetchFn: typeof fetch
  private readonly pollIntervalMs: number
  private readonly pushDelayMs: number
  private readonly listeners = new Set<() => void>()
  private clock: Clock = createClock('init')
  private clientId = ''
  /** Per space, or a protocol 1 number still to move over (until the first pull). */
  private cursor: SpaceCursor | number = {}
  private outboxOrder = 0
  private pushTimer: ReturnType<typeof setTimeout> | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  /** The sync run in progress, and the one queued after it (at most one). */
  private running: Promise<void> | null = null
  private queued: Promise<void> | null = null
  /** Outbox writes that have not finished yet. */
  private writes: Promise<void> = Promise.resolve()
  private stopped = false
  private readonly entityCache = new Map<EntityType, { version: number; items: Entity[] }>()

  constructor(options: EngineOptions) {
    this.db = new LocalDb(options.dbName ?? dbNameFor(options.userId))
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init))
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000
    this.pushDelayMs = options.pushDelayMs ?? 300
  }

  async start(): Promise<void> {
    const meta = await this.db.meta.toArray()
    const storedClient = meta.find((m) => m.key === 'clientId')?.value
    this.clientId = typeof storedClient === 'string' ? storedClient : newClientId()
    if (!storedClient) await this.db.meta.put({ key: 'clientId', value: this.clientId })
    this.clock = createClock(this.clientId)

    for (const { key, ...rec } of await this.db.entities.toArray()) {
      this.records.set(key, rec)
      for (const ts of Object.values(rec.fieldTs)) this.clock.receive(ts)
    }
    const cursors = meta.find((m) => m.key === 'cursors')?.value
    const legacy = meta.find((m) => m.key === 'cursor')?.value
    if (cursors && typeof cursors === 'object') this.cursor = cursors
    else if (typeof legacy === 'number' && (legacy > 0 || this.records.size > 0)) {
      this.cursor = legacy
    } else this.cursor = {}
    const last = await this.db.outbox.orderBy('order').last()
    this.outboxOrder = last?.order ?? 0
    this.bump()

    await this.sync()
    this.ready = true
    this.bump()
    this.installTriggers()
  }

  stop(): void {
    this.stopped = true
    if (this.pushTimer) clearTimeout(this.pushTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.removeTriggers?.()
    this.db.close()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  /** Alle geldige, niet-verwijderde entiteiten van één type; gecachet per versie. */
  entities<T extends EntityType>(entityType: T): Extract<Entity, { id: string }>[] {
    const cached = this.entityCache.get(entityType)
    if (cached && cached.version === this.version) return cached.items
    const schema = entitySchemas[entityType]
    const items: Entity[] = []
    for (const rec of this.records.values()) {
      if (rec.entityType !== entityType || isDeleted(rec)) continue
      const parsed = schema.safeParse(rec.data)
      if (parsed.success) items.push(parsed.data)
    }
    this.entityCache.set(entityType, { version: this.version, items })
    return items
  }

  /** Maakt een nieuwe entiteit; `entity` moet compleet zijn (gebruik de makers uit core). */
  create(entityType: EntityType, entity: Entity): void {
    const { id, ...fields } = entity
    this.mutate(entityType, id, fields)
  }

  /**
   * Moves an area, project or task (with its children) to another space. The
   * record gets the new space at once; the children, and the tags and
   * containers the server adjusts, follow with the next pull.
   */
  moveToSpace(entityType: EntityType, entityId: string, spaceId: string): void {
    const key = recordKey(entityType, entityId)
    const current = this.records.get(key)
    if (!current) return
    const change: Change = {
      id: ulid(),
      entityType,
      entityId,
      fields: { [SPACE_FIELD]: spaceId },
      ts: this.clock.now(),
      clientId: this.clientId,
    }
    const record = { ...current, spaceId }
    this.records.set(key, record)
    this.bump()
    this.queue(key, record, change)
  }

  /** Past velden aan: meteen lokaal zichtbaar, daarna in de outbox en gepusht. */
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
    // `applyChange` keeps the other properties of the record, `spaceId` too.
    const record: LocalRecord = applyChange(this.records.get(key), change)
    this.records.set(key, record)
    this.bump()
    this.queue(key, record, change)
  }

  /** Stores the record and the change in the outbox, and schedules a push. */
  private queue(key: string, record: LocalRecord, change: Change): void {
    this.outboxOrder += 1
    const order = this.outboxOrder
    const write = this.db.transaction('rw', this.db.entities, this.db.outbox, async () => {
      await this.db.entities.put({ key, ...record })
      await this.db.outbox.put({ id: change.id, order, change })
    })
    // push() waits for this, so a sync right after a change includes it.
    this.writes = Promise.all([this.writes, write.catch(() => {})]).then(() => {})
    this.schedulePush()
  }

  /**
   * Push the outbox, then pull new changes. Safe to call often. While a run is
   * in progress, calls share one follow-up run, and the returned promise only
   * resolves once that run is done, so `await sync()` always includes changes
   * made before the call.
   */
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) {
      this.queued ??= this.running.then(() => {
        this.queued = null
        return this.sync()
      })
      return this.queued
    }
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<void> {
    this.setStatus('syncing')
    try {
      await this.push()
      await this.pull()
      this.setStatus('idle')
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.setStatus('unauthorized')
        this.onUnauthorized?.()
      } else {
        this.setStatus('offline')
      }
    }
  }

  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => void this.sync(), this.pushDelayMs)
  }

  private async push(): Promise<void> {
    await this.writes
    const items = await this.db.outbox.orderBy('order').toArray()
    if (items.length === 0) return
    const changes = items.map((i) => i.change)
    const cursor = typeof this.cursor === 'number' ? undefined : this.cursor
    const res = await this.request('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cursor ? { changes, cursor } : { changes }),
    })
    if (res.status === 400) {
      // Een afgekeurde wijziging zou een bug zijn; laat hem niet de hele outbox blokkeren.
      const body = (await res.json()) as { problems?: { changeId: string; issues: string[] }[] }
      console.error('Server rejected changes', body.problems)
      await this.db.outbox.bulkDelete((body.problems ?? []).map((p) => p.changeId))
      return
    }
    if (!res.ok) throw new Error(`push ${res.status}`)
    await this.db.outbox.bulkDelete(items.map((i) => i.id))
    // Spaces where nothing but this push happened: no need to pull our own changes back.
    const body = (await res.json().catch(() => null)) as PushResponse | null
    if (body?.placed) await this.place(body.placed)
    if (body?.cursor && typeof this.cursor !== 'number') {
      await this.setCursor(mergeCursor(this.cursor, body.cursor))
    }
  }

  /** Notes the space the server put new or moved entities in. */
  private async place(placed: NonNullable<PushResponse['placed']>): Promise<void> {
    const changed: StoredRecord[] = []
    for (const { entityType, id, spaceId } of placed) {
      const key = recordKey(entityType, id)
      const rec = this.records.get(key)
      if (!rec || rec.spaceId === spaceId) continue
      const record = { ...rec, spaceId }
      this.records.set(key, record)
      changed.push({ key, ...record })
    }
    if (changed.length === 0) return
    await this.db.entities.bulkPut(changed)
    this.bump()
  }

  private async pull(): Promise<void> {
    let cursor = this.cursor
    let hasMore = true
    while (hasMore) {
      const param = encodeURIComponent(JSON.stringify(cursor))
      const res = await this.request(`/api/sync/pull?cursor=${param}`)
      if (!res.ok) throw new Error(`pull ${res.status}`)
      const body = (await res.json()) as PullResponse
      await this.applyPull(body)
      cursor = body.cursor
      hasMore = body.hasMore
    }
    await this.setCursor(cursor)
  }

  /** One pull answer: drop spaces we left, replace spaces new to us, apply changes. */
  private async applyPull(body: PullResponse): Promise<void> {
    const personal = body.spaces.find((s) => s.kind === 'personal')?.id
    const spaceOf = (rec: LocalRecord) => rec.spaceId ?? personal
    const fresh = body.spaces.filter((s) => s.entities)
    const dropped = new Set([...body.removed, ...fresh.map((s) => s.id)])
    const gone: string[] = []
    if (dropped.size > 0) {
      // Keep what is still in the outbox: it was pushed before this pull, or will be.
      const pending = new Set(
        (await this.db.outbox.toArray()).map((i) =>
          recordKey(i.change.entityType, i.change.entityId),
        ),
      )
      for (const [key, rec] of this.records) {
        const space = spaceOf(rec)
        if (space && dropped.has(space) && !pending.has(key)) gone.push(key)
      }
    }
    const touched = new Map<string, LocalRecord>()
    for (const key of gone) this.records.delete(key)
    for (const space of fresh) {
      for (const rec of space.entities ?? []) {
        const key = recordKey(rec.entityType, rec.id)
        const record = { ...rec, spaceId: space.id }
        for (const ts of Object.values(rec.fieldTs)) this.clock.receive(ts)
        touched.set(key, record)
        this.records.set(key, record)
      }
    }
    for (const space of body.spaces) {
      for (const change of space.changes) {
        this.clock.receive(change.ts)
        const key = recordKey(change.entityType, change.entityId)
        const current = touched.get(key) ?? this.records.get(key)
        // A change never moves a record: it stays in its space, a new one takes this one.
        const record = { ...applyChange(current, change), spaceId: current?.spaceId ?? space.id }
        touched.set(key, record)
        this.records.set(key, record)
      }
    }
    // Moves, after all changes: an arrival is the whole current record, in its new space.
    for (const space of body.spaces) {
      for (const rec of space.arrived ?? []) {
        const key = recordKey(rec.entityType, rec.id)
        const record = { ...rec, spaceId: space.id }
        for (const ts of Object.values(rec.fieldTs)) this.clock.receive(ts)
        touched.set(key, record)
        this.records.set(key, record)
      }
    }
    for (const space of body.spaces) {
      for (const { entityType, id } of space.left ?? []) {
        const key = recordKey(entityType, id)
        touched.delete(key)
        this.records.delete(key)
        gone.push(key)
      }
    }
    if (gone.length === 0 && touched.size === 0) return
    const stillGone = gone.filter((key) => !touched.has(key))
    await this.db.transaction('rw', this.db.entities, async () => {
      if (stillGone.length > 0) await this.db.entities.bulkDelete(stillGone)
      await this.db.entities.bulkPut([...touched].map(([key, rec]) => ({ key, ...rec })))
    })
    this.bump()
  }

  private async setCursor(cursor: SpaceCursor | number): Promise<void> {
    this.cursor = cursor
    if (typeof cursor === 'number') return
    await this.db.transaction('rw', this.db.meta, async () => {
      await this.db.meta.put({ key: 'cursors', value: cursor })
      await this.db.meta.delete('cursor')
    })
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchFn(withBase(path), {
      ...init,
      headers: { accept: 'application/json', ...init?.headers },
    })
    if (res.status === 401) throw new UnauthorizedError()
    return res
  }

  private setStatus(status: SyncStatus): void {
    if (this.status === status) return
    this.status = status
    this.bump()
  }

  private bump(): void {
    this.version += 1
    for (const l of this.listeners) l()
  }

  private removeTriggers: (() => void) | undefined

  private installTriggers(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const onWake = () => {
      if (document.visibilityState === 'visible') void this.sync()
    }
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    this.pollTimer = setInterval(onWake, this.pollIntervalMs)
    this.removeTriggers = () => {
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
  }
}
