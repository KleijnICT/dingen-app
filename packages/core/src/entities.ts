import { z } from 'zod'
import { TIMESTAMP_PATTERN } from './hlc.js'
import { ULID_PATTERN } from './ids.js'

/** Kalenderdatum zonder tijdzone, zoals een gebruiker hem ziet. */
export const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als YYYY-MM-DD')
export type CalendarDate = z.infer<typeof CalendarDate>

const IsoDateTime = z.string().datetime({ offset: true })
const Id = z.string().regex(ULID_PATTERN, 'Id moet een ULID zijn')
const Order = z.string().min(1)

const Base = z.object({
  id: Id,
  createdAt: IsoDateTime,
  deleted: z.boolean(),
})

export const Status = z.enum(['open', 'completed', 'canceled'])
export type Status = z.infer<typeof Status>

/**
 * Wanneer een taak of project beschikbaar is. Dit ene veld bepaalt de lijst:
 * inbox, anytime, someday, of een datum (vandaag of binnenkort).
 */
export const When = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inbox') }),
  z.object({ kind: z.literal('anytime') }),
  z.object({ kind: z.literal('someday') }),
  z.object({ kind: z.literal('date'), date: CalendarDate }),
])
export type When = z.infer<typeof When>

/** Icon ids an area can show; the web app maps each to a drawing. */
export const AREA_ICONS = [
  'home',
  'briefcase',
  'building',
  'heart',
  'heart-pulse',
  'dumbbell',
  'wrench',
  'hammer',
  'server',
  'cpu',
  'bot',
  'code',
  'laptop',
  'wallet',
  'piggy-bank',
  'bitcoin',
  'landmark',
  'receipt',
  'book-open',
  'graduation-cap',
  'pen-line',
  'palette',
  'camera',
  'music',
  'gamepad',
  'plane',
  'car',
  'bike',
  'trees',
  'sprout',
  'sun',
  'dog',
  'baby',
  'users',
  'shopping-cart',
  'utensils',
  'coffee',
  'gift',
  'calendar',
  'clipboard-list',
  'folder',
  'archive',
  'globe',
  'zap',
  'shield',
  'lightbulb',
  'star',
  'flag',
] as const
export type AreaIconId = (typeof AREA_ICONS)[number]

/** Colour ids an area can have; the first is the neutral one. */
export const AREA_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'mint',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const
export type AreaColorId = (typeof AREA_COLORS)[number]

/**
 * `icon` and `color` are plain strings so ids from a newer version survive a
 * round trip; null means the default look. Areas synced before these fields
 * existed parse with nulls.
 */
export const Area = Base.extend({
  title: z.string(),
  order: Order,
  icon: z.string().nullable().default(null),
  color: z.string().nullable().default(null),
  /** Last time the area was ticked off in a review; null = never. */
  reviewedAt: IsoDateTime.nullable().default(null),
})
export type Area = z.infer<typeof Area>

export const Project = Base.extend({
  title: z.string(),
  notes: z.string(),
  areaId: Id.nullable(),
  status: Status,
  when: When,
  deadline: CalendarDate.nullable(),
  tagIds: z.array(Id),
  order: Order,
  completedAt: IsoDateTime.nullable(),
  /** Last time the project was ticked off in a review; null = never. */
  reviewedAt: IsoDateTime.nullable().default(null),
})
export type Project = z.infer<typeof Project>

export const Heading = Base.extend({
  projectId: Id,
  title: z.string(),
  order: Order,
})
export type Heading = z.infer<typeof Heading>

/**
 * Herhaalregel van een herhalende taak (template). `schedule` herhaalt op
 * vaste datums vanaf `start`; `completion` telt het interval vanaf de dag van
 * afronden. Maandelijks en jaarlijks nemen de dag van de maand van `start`.
 */
export const Repeat = z.object({
  unit: z.enum(['day', 'week', 'month', 'year']),
  every: z.number().int().min(1).max(999),
  basis: z.enum(['schedule', 'completion']),
  /** Alleen voor week + schedule; leeg betekent de weekdag van `start`. 0 = zondag. */
  weekdays: z.array(z.number().int().min(0).max(6)),
  start: CalendarDate,
  until: CalendarDate.nullable(),
  /** Deadline zoveel dagen na de datum van elk exemplaar; null = geen deadline. */
  deadlineDays: z.number().int().min(0).max(3650).nullable(),
})
export type Repeat = z.infer<typeof Repeat>

/** Kloktijd van de dag, `HH:MM` (24 uur). */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Tijd als HH:MM')
export type TimeOfDay = z.infer<typeof TimeOfDay>

/**
 * Herinnering bij een taak met een datum: `daysBefore` dagen vóór de datum om
 * `time` (in DINGEN_TIMEZONE). Relatief, zodat hij meeschuift met de datum en
 * meegaat naar het volgende exemplaar van een herhalende taak.
 */
export const Reminder = z.object({
  daysBefore: z.number().int().min(0).max(365),
  time: TimeOfDay,
})
export type Reminder = z.infer<typeof Reminder>

export const Task = Base.extend({
  title: z.string(),
  notes: z.string(),
  status: Status,
  projectId: Id.nullable(),
  headingId: Id.nullable(),
  areaId: Id.nullable(),
  when: When,
  evening: z.boolean(),
  /** Tijd van de dag bij een `when`-datum; null = geen tijd. */
  time: TimeOfDay.nullable().default(null),
  /** Herinnering bij een `when`-datum; null = geen. */
  reminder: Reminder.nullable().default(null),
  deadline: CalendarDate.nullable(),
  tagIds: z.array(Id),
  /** Een taak mét regel is een verborgen template; zijn exemplaren wijzen ernaar. */
  repeat: Repeat.nullable(),
  templateId: Id.nullable().default(null),
  order: Order,
  /** Volgorde in Vandaag, los van de projectvolgorde; null betekent: volg `order`. */
  todayOrder: Order.nullable().default(null),
  completedAt: IsoDateTime.nullable(),
})
export type Task = z.infer<typeof Task>

export const ChecklistItem = Base.extend({
  taskId: Id,
  title: z.string(),
  done: z.boolean(),
  order: Order,
})
export type ChecklistItem = z.infer<typeof ChecklistItem>

export const Tag = Base.extend({
  title: z.string(),
  parentId: Id.nullable(),
  order: Order,
})
export type Tag = z.infer<typeof Tag>

export const ReviewKind = z.enum(['daily', 'weekly', 'monthly'])
export type ReviewKind = z.infer<typeof ReviewKind>

/**
 * One run of a review. `completedAt` is null while it runs. `doneSteps` holds
 * step ids (and group keys such as `somedayDeep:<areaId>`); plain strings so
 * ids from a newer version survive a round trip.
 */
export const Review = Base.extend({
  kind: ReviewKind,
  startedAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
  doneSteps: z.array(z.string()),
})
export type Review = z.infer<typeof Review>

export const entitySchemas = {
  area: Area,
  project: Project,
  heading: Heading,
  task: Task,
  checklistItem: ChecklistItem,
  tag: Tag,
  review: Review,
} as const

export const EntityType = z.enum([
  'area',
  'project',
  'heading',
  'task',
  'checklistItem',
  'tag',
  'review',
])
export type EntityType = z.infer<typeof EntityType>

export type EntityOf<T extends EntityType> = z.infer<(typeof entitySchemas)[T]>
export type Entity = Area | Project | Heading | Task | ChecklistItem | Tag | Review

/**
 * Eén wijziging aan één entiteit. `fields` bevat alleen de gewijzigde velden.
 * Bij een nieuwe entiteit moeten alle verplichte velden erin zitten.
 */
export const Change = z.object({
  id: Id,
  entityType: EntityType,
  entityId: Id,
  fields: z.record(z.string(), z.unknown()),
  ts: z.string().regex(TIMESTAMP_PATTERN, 'ts moet een HLC-tijdstempel zijn'),
  clientId: z.string().min(1).max(64),
})
export type Change = z.infer<typeof Change>

export type ValidationResult = { ok: true } | { ok: false; issues: string[] }

/**
 * Controleert de velden van een wijziging tegen het schema van de entiteit.
 * Zonder bestaande entiteit moet de wijziging een complete entiteit vormen.
 */
export function validateChangeFields(
  change: Change,
  existing: Record<string, unknown> | undefined,
): ValidationResult {
  const schema = entitySchemas[change.entityType]
  if ('id' in change.fields && change.fields.id !== change.entityId) {
    return { ok: false, issues: ['fields.id wijkt af van entityId'] }
  }
  const candidate = existing
    ? { ...existing, ...change.fields }
    : { id: change.entityId, ...change.fields }
  const result = schema.strict().safeParse(candidate)
  if (result.success) return { ok: true }
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  }
}
