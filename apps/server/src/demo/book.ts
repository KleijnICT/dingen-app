import {
  type Area,
  addDays,
  type CalendarDate,
  type EntityOf,
  type EntityType,
  entitySchemas,
  formatTimestamp,
  type Heading,
  instanceOf,
  newArea,
  newChecklistItem,
  newHeading,
  newProject,
  newReview,
  newTag,
  newTask,
  orderBetween,
  type Project,
  type Repeat,
  type ReviewKind,
  type Task,
  type When,
} from '@dingen/core'
import type { ImportRecord } from '../sync.js'
import { zonedIso } from './time.js'

/** When the demo set is built: the instant and the time zone that sets "today". */
export interface DemoContext {
  now: Date
  timezone: string
  today: CalendarDate
}

/** Days from today (negative is in the past), or one of the lists. */
export type WhenInput = 'inbox' | 'anytime' | 'someday' | number

export interface TaskInput {
  notes?: string
  area?: Area
  project?: Project
  heading?: Heading
  when?: WhenInput
  evening?: boolean
  time?: string
  /** [days before, time]. */
  reminder?: [number, string]
  /** Days from today. */
  deadline?: number
  tags?: string[]
  /** Titles; a leading "x " marks an item as done. */
  checklist?: string[]
  /** Created this many days ago. */
  created?: number
  /** Completed this many days ago, at `doneAt`. */
  done?: number
  doneAt?: string
  /** Canceled this many days ago. */
  canceled?: number
}

export interface ProjectInput {
  notes?: string
  area?: Area
  when?: WhenInput
  deadline?: number
  created?: number
  /** Reviewed this many days ago; omitted means never. */
  reviewed?: number
  done?: number
}

const MINUTE = 60_000

/**
 * Collects the entities of one account as import records. Every entity is
 * built with the core constructors and checked against its schema, so the set
 * is exactly what a client could have synced.
 */
export class Book {
  readonly records: ImportRecord[] = []
  private lastOrder: string | null = null
  private readonly ts: string
  private readonly tagIds = new Map<string, string>()

  constructor(private readonly ctx: DemoContext) {
    this.ts = formatTimestamp(ctx.now.getTime(), 0, 'DEMO')
  }

  day(offset: number): CalendarDate {
    return addDays(this.ctx.today, offset)
  }

  /** An instant `days` ago at a wall-clock time, never later than a few minutes ago. */
  ago(days: number, time = '10:00'): string {
    const iso = zonedIso(this.day(-days), time, this.ctx.timezone)
    const latest = this.ctx.now.getTime() - 5 * MINUTE
    return Date.parse(iso) > latest ? new Date(latest).toISOString() : iso
  }

  /** Increasing order keys; only the relative order within a list matters. */
  private order(): string {
    const next = orderBetween(this.lastOrder, null)
    this.lastOrder = next
    return next
  }

  private when(input: WhenInput): When {
    if (typeof input === 'number') return { kind: 'date', date: this.day(input) }
    return { kind: input }
  }

  private put<T extends EntityType>(type: T, entity: EntityOf<T>): EntityOf<T> {
    const data = entitySchemas[type].strict().parse(entity) as Record<string, unknown>
    const fieldTs: Record<string, string> = {}
    for (const key of Object.keys(data)) if (key !== 'id') fieldTs[key] = this.ts
    this.records.push({ entityType: type, id: entity.id, data, fieldTs })
    return entity
  }

  tag(title: string): void {
    const tag = newTag({ title, order: this.order(), createdAt: this.ago(60) })
    this.tagIds.set(title, tag.id)
    this.put('tag', tag)
  }

  private tagsOf(titles: string[] = []): string[] {
    return titles.map((t) => {
      const id = this.tagIds.get(t)
      if (!id) throw new Error(`Unknown demo tag: ${t}`)
      return id
    })
  }

  area(title: string, icon: string, color: string, reviewed?: number): Area {
    return this.put(
      'area',
      newArea({
        title,
        icon,
        color,
        order: this.order(),
        createdAt: this.ago(90),
        reviewedAt: reviewed === undefined ? null : this.ago(reviewed, '16:30'),
      }),
    )
  }

  project(title: string, input: ProjectInput = {}): Project {
    const created = input.created ?? (input.done ?? 0) + 14
    return this.put(
      'project',
      newProject({
        title,
        notes: input.notes ?? '',
        areaId: input.area?.id ?? null,
        when: this.when(input.when ?? 'anytime'),
        deadline: input.deadline === undefined ? null : this.day(input.deadline),
        order: this.order(),
        createdAt: this.ago(created, '09:00'),
        reviewedAt: input.reviewed === undefined ? null : this.ago(input.reviewed, '16:30'),
        status: input.done === undefined ? 'open' : 'completed',
        completedAt: input.done === undefined ? null : this.ago(input.done, '17:00'),
      }),
    )
  }

  heading(project: Project, title: string): Heading {
    return this.put(
      'heading',
      newHeading({
        projectId: project.id,
        title,
        order: this.order(),
        createdAt: project.createdAt,
      }),
    )
  }

  private taskFields(title: string, input: TaskInput): Task {
    const project = input.project
    const closedDays = input.done ?? input.canceled
    const created = input.created ?? (closedDays ?? 0) + 3
    return newTask({
      title,
      notes: input.notes ?? '',
      projectId: project?.id ?? input.heading?.projectId ?? null,
      headingId: input.heading?.id ?? null,
      areaId: project || input.heading ? null : (input.area?.id ?? null),
      when: this.when(input.when ?? (closedDays !== undefined ? 'anytime' : 'inbox')),
      evening: input.evening ?? false,
      time: input.time ?? null,
      reminder: input.reminder ? { daysBefore: input.reminder[0], time: input.reminder[1] } : null,
      deadline: input.deadline === undefined ? null : this.day(input.deadline),
      tagIds: this.tagsOf(input.tags),
      order: this.order(),
      createdAt: this.ago(created, '08:45'),
      status:
        input.done !== undefined ? 'completed' : input.canceled !== undefined ? 'canceled' : 'open',
      completedAt: closedDays === undefined ? null : this.ago(closedDays, input.doneAt ?? '15:20'),
    })
  }

  task(title: string, input: TaskInput = {}): Task {
    const task = this.put('task', this.taskFields(title, input))
    this.checklist(task, input.checklist ?? [])
    return task
  }

  private checklist(task: Task, items: string[]): void {
    for (const item of items) {
      const done = item.startsWith('x ')
      this.put(
        'checklistItem',
        newChecklistItem({
          taskId: task.id,
          title: done ? item.slice(2) : item,
          done,
          order: this.order(),
          createdAt: task.createdAt,
        }),
      )
    }
  }

  /**
   * A repeating task: the hidden template, one open instance on `nextDay`, and
   * completed instances `history` days ago, the way completing them would have
   * left them.
   */
  repeating(
    title: string,
    rule: Omit<Repeat, 'until' | 'deadlineDays' | 'weekdays'> & Partial<Repeat>,
    nextDay: number,
    input: TaskInput = {},
    history: number[] = [],
  ): Task {
    const template = this.put('task', {
      ...this.taskFields(title, { ...input, when: 'anytime' }),
      repeat: { until: null, deadlineDays: null, weekdays: [], ...rule },
    })
    for (const days of history) {
      this.put('task', {
        ...instanceOf(template, this.day(-days), this.order()),
        createdAt: this.ago(days + 1, '08:00'),
        status: 'completed',
        completedAt: this.ago(days, input.doneAt ?? '18:10'),
      })
    }
    const instance = this.put('task', {
      ...instanceOf(template, this.day(nextDay), this.order()),
      createdAt: this.ago(history.length > 0 ? Math.min(...history) : 7, '08:00'),
    })
    this.checklist(instance, input.checklist ?? [])
    return instance
  }

  review(kind: ReviewKind, completedDaysAgo: number, doneSteps: string[]): void {
    const startedAt = this.ago(completedDaysAgo, '16:00')
    this.put(
      'review',
      newReview({
        kind,
        createdAt: startedAt,
        startedAt,
        completedAt: this.ago(completedDaysAgo, '16:40'),
        doneSteps,
      }),
    )
  }
}
