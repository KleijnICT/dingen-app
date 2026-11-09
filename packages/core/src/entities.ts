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

export const Area = Base.extend({
  title: z.string(),
  order: Order,
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
})
export type Project = z.infer<typeof Project>

export const Heading = Base.extend({
  projectId: Id,
  title: z.string(),
  order: Order,
})
export type Heading = z.infer<typeof Heading>

/** Herhaalregel; wordt in onderdeel 6 ingevuld. Nu alleen "geen herhaling". */
export const Repeat = z.null()
export type Repeat = z.infer<typeof Repeat>

export const Task = Base.extend({
  title: z.string(),
  notes: z.string(),
  status: Status,
  projectId: Id.nullable(),
  headingId: Id.nullable(),
  areaId: Id.nullable(),
  when: When,
  evening: z.boolean(),
  deadline: CalendarDate.nullable(),
  tagIds: z.array(Id),
  repeat: Repeat,
  order: Order,
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

export const entitySchemas = {
  area: Area,
  project: Project,
  heading: Heading,
  task: Task,
  checklistItem: ChecklistItem,
  tag: Tag,
} as const

export const EntityType = z.enum(['area', 'project', 'heading', 'task', 'checklistItem', 'tag'])
export type EntityType = z.infer<typeof EntityType>

export type EntityOf<T extends EntityType> = z.infer<(typeof entitySchemas)[T]>
export type Entity = Area | Project | Heading | Task | ChecklistItem | Tag

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
