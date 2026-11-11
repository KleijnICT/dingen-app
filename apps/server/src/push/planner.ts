import { reminderMoment, Task } from '@dingen/core'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { wallToInstant } from '../calendar/ics.js'
import type { Db } from '../db.js'
import { entities, pushSubscriptions, reminderDeliveries } from '../schema.js'
import type { PushPayload, PushService } from './service.js'

/** Hoe vaak de planner kijkt. */
export const TICK_MS = 30_000
/** Een gemiste herinnering (server stond uit) gaat tot zo lang na het moment nog uit. */
export const LATE_MS = 60 * 60_000
/** Bezorgregels ouder dan dit worden opgeruimd. */
const KEEP_MS = 7 * 24 * 60 * 60_000

export interface PlannerOptions {
  timezone: string
  /** De klok; tests geven een nep-klok mee. */
  now?: () => number
}

/**
 * Stuurt herinneringen op het juiste moment. Het moment is een kloktijd in
 * DINGEN_TIMEZONE; elke herinnering gaat één keer uit (vastgelegd in
 * `reminder_deliveries`), ook als de server tussendoor herstart.
 */
export class ReminderPlanner {
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<number> | null = null
  private readonly now: () => number

  constructor(
    private readonly db: Db,
    private readonly push: PushService,
    private readonly options: PlannerOptions,
  ) {
    this.now = options.now ?? Date.now
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick().catch((err) => console.error(err)), TICK_MS)
    this.timer.unref?.()
    void this.tick().catch((err) => console.error(err))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Eén ronde: verstuurt wat aan de beurt is en geeft het aantal herinneringen terug. */
  tick(): Promise<number> {
    // Nooit twee rondes tegelijk, anders kan een trage push dubbel uitgaan.
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  /** De herinneringen die nu aan de beurt zijn en nog niet verstuurd. */
  due(): { userId: string; task: Task; moment: string }[] {
    const now = this.now()
    const users = this.db
      .selectDistinct({ userId: pushSubscriptions.userId })
      .from(pushSubscriptions)
      .all()
      .map((r) => r.userId)
    if (users.length === 0) return []
    const rows = this.db
      .select({ userId: entities.userId, data: entities.data })
      .from(entities)
      .where(
        and(
          eq(entities.entityType, 'task'),
          eq(entities.deleted, false),
          inArray(entities.userId, users),
          sql`json_extract(${entities.data}, '$.reminder') is not null`,
          sql`json_extract(${entities.data}, '$.status') = 'open'`,
        ),
      )
      .all()
    const result: { userId: string; task: Task; moment: string }[] = []
    for (const row of rows) {
      const parsed = Task.safeParse(row.data)
      if (!parsed.success) continue
      const wall = reminderMoment(parsed.data)
      if (!wall) continue
      const [year, month, day] = wall.date.split('-').map(Number) as [number, number, number]
      const [hour, minute] = wall.time.split(':').map(Number) as [number, number]
      const at = wallToInstant({ year, month, day, hour, minute, second: 0 }, this.options.timezone)
      if (at > now || at <= now - LATE_MS) continue
      const moment = new Date(at).toISOString()
      const seen = this.db
        .select({ moment: reminderDeliveries.moment })
        .from(reminderDeliveries)
        .where(
          and(
            eq(reminderDeliveries.userId, row.userId),
            eq(reminderDeliveries.taskId, parsed.data.id),
            eq(reminderDeliveries.moment, moment),
          ),
        )
        .get()
      if (!seen) result.push({ userId: row.userId, task: parsed.data, moment })
    }
    return result
  }

  private async run(): Promise<number> {
    const due = this.due()
    const sentAt = new Date(this.now()).toISOString()
    for (const item of due) {
      // Eerst vastleggen: liever een keer geen melding dan twee.
      this.db
        .insert(reminderDeliveries)
        .values({ userId: item.userId, taskId: item.task.id, moment: item.moment, sentAt })
        .onConflictDoNothing()
        .run()
    }
    await Promise.all(due.map((item) => this.push.send(item.userId, this.payload(item))))
    this.db
      .delete(reminderDeliveries)
      .where(lt(reminderDeliveries.sentAt, new Date(this.now() - KEEP_MS).toISOString()))
      .run()
    return due.length
  }

  private payload({ userId, task }: { userId: string; task: Task }): PushPayload {
    const containerId = task.projectId ?? task.areaId
    let container: string | null = null
    if (containerId) {
      const row = this.db
        .select({ data: entities.data })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            inArray(entities.entityType, ['project', 'area']),
            eq(entities.id, containerId),
          ),
        )
        .get()
      const title = row?.data.title
      container = typeof title === 'string' && title ? title : null
    }
    const body = [task.time, container].filter(Boolean).join(' · ')
    return { title: task.title || '…', body, tag: task.id, url: '/today' }
  }
}
