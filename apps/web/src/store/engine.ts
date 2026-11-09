import {
  applyChange,
  type Change,
  type Clock,
  createClock,
  type Entity,
  type EntityRecord,
  type EntityType,
  entitySchemas,
  isDeleted,
  clientId as newClientId,
  recordKey,
  ulid,
} from '@dingen/core'
import { dbNameFor, LocalDb } from './db.js'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unauthorized'

export interface EngineOptions {
  userId: string
  /** Vervangbaar in tests. */
  fetchFn?: typeof fetch
  dbName?: string
  pollIntervalMs?: number
  pushDelayMs?: number
}

interface PullBody {
  changes: Change[]
  seq: number
  hasMore: boolean
}

interface SnapshotBody {
  entities: EntityRecord[]
  seq: number
}

/**
 * De sync-engine van de browser: lokale replica, outbox, push en pull.
 * Zelfde protocol als straks de native clients, bewust zonder slimmigheden.
 */
export class SyncEngine {
  readonly records = new Map<string, EntityRecord>()
  /** Loopt op bij elke verandering; React gebruikt dit als snapshot. */
  version = 0
  status: SyncStatus = 'idle'
  onUnauthorized: (() => void) | undefined

  private readonly db: LocalDb
  private readonly fetchFn: typeof fetch
  private readonly pollIntervalMs: number
  private readonly pushDelayMs: number
  private readonly listeners = new Set<() => void>()
  private clock: Clock = createClock('init')
  private clientId = ''
  private cursor = 0
  private outboxOrder = 0
  private pushTimer: ReturnType<typeof setTimeout> | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private syncing = false
  private syncAgain = false
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
    const storedCursor = meta.find((m) => m.key === 'cursor')?.value
    this.cursor = typeof storedCursor === 'number' ? storedCursor : 0
    this.clock = createClock(this.clientId)

    for (const rec of await this.db.entities.toArray()) {
      this.records.set(rec.key, {
        entityType: rec.entityType,
        id: rec.id,
        data: rec.data,
        fieldTs: rec.fieldTs,
      })
      for (const ts of Object.values(rec.fieldTs)) this.clock.receive(ts)
    }
    const last = await this.db.outbox.orderBy('order').last()
    this.outboxOrder = last?.order ?? 0
    this.bump()

    await this.sync()
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
    const record = applyChange(this.records.get(key), change)
    this.records.set(key, record)
    this.bump()
    this.outboxOrder += 1
    const order = this.outboxOrder
    void this.db.transaction('rw', this.db.entities, this.db.outbox, async () => {
      await this.db.entities.put({ key, ...record })
      await this.db.outbox.put({ id: change.id, order, change })
    })
    this.schedulePush()
  }

  /** Push de outbox en haal daarna nieuwe wijzigingen op. Veilig om vaak aan te roepen. */
  async sync(): Promise<void> {
    if (this.stopped) return
    if (this.syncing) {
      this.syncAgain = true
      return
    }
    this.syncing = true
    this.setStatus('syncing')
    try {
      await this.push()
      if (this.cursor === 0 && this.records.size === 0) {
        await this.snapshot()
      } else {
        await this.pull()
      }
      this.setStatus('idle')
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.setStatus('unauthorized')
        this.onUnauthorized?.()
      } else {
        this.setStatus('offline')
      }
    } finally {
      this.syncing = false
      if (this.syncAgain) {
        this.syncAgain = false
        void this.sync()
      }
    }
  }

  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => void this.sync(), this.pushDelayMs)
  }

  private async push(): Promise<void> {
    const items = await this.db.outbox.orderBy('order').toArray()
    if (items.length === 0) return
    const res = await this.request('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: items.map((i) => i.change) }),
    })
    if (res.status === 400) {
      // Een afgekeurde wijziging zou een bug zijn; laat hem niet de hele outbox blokkeren.
      const body = (await res.json()) as { problems?: { changeId: string; issues: string[] }[] }
      console.error('Server keurde wijzigingen af', body.problems)
      await this.db.outbox.bulkDelete((body.problems ?? []).map((p) => p.changeId))
      return
    }
    if (!res.ok) throw new Error(`push ${res.status}`)
    await this.db.outbox.bulkDelete(items.map((i) => i.id))
  }

  private async pull(): Promise<void> {
    let since = this.cursor
    let hasMore = true
    while (hasMore) {
      const res = await this.request(`/api/sync/pull?since=${since}`)
      if (!res.ok) throw new Error(`pull ${res.status}`)
      const body = (await res.json()) as PullBody
      await this.applyRemote(body.changes)
      since = body.seq
      hasMore = body.hasMore
    }
    await this.setCursor(since)
  }

  private async snapshot(): Promise<void> {
    const res = await this.request('/api/sync/snapshot')
    if (!res.ok) throw new Error(`snapshot ${res.status}`)
    const body = (await res.json()) as SnapshotBody
    const stored = body.entities.map((rec) => {
      const key = recordKey(rec.entityType, rec.id)
      this.records.set(key, rec)
      for (const ts of Object.values(rec.fieldTs)) this.clock.receive(ts)
      return { key, ...rec }
    })
    await this.db.entities.bulkPut(stored)
    await this.setCursor(body.seq)
    this.bump()
  }

  private async applyRemote(changes: Change[]): Promise<void> {
    if (changes.length === 0) return
    const touched = new Map<string, EntityRecord>()
    for (const change of changes) {
      this.clock.receive(change.ts)
      const key = recordKey(change.entityType, change.entityId)
      const record = applyChange(touched.get(key) ?? this.records.get(key), change)
      touched.set(key, record)
      this.records.set(key, record)
    }
    await this.db.entities.bulkPut([...touched].map(([key, rec]) => ({ key, ...rec })))
    this.bump()
  }

  private async setCursor(seq: number): Promise<void> {
    this.cursor = seq
    await this.db.meta.put({ key: 'cursor', value: seq })
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchFn(path, {
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
