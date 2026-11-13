import { createHash } from 'node:crypto'
import {
  type Area,
  type ChecklistItem,
  type Entity,
  type EntityType,
  firstOccurrence,
  type Heading,
  instanceOf,
  isDeleted,
  newArea,
  newHeading,
  newProject,
  newTag,
  normalizeTagTitle,
  ordersBetween,
  type Project,
  type Repeat,
  sameTagTitle,
  type Tag,
  type Task,
} from '@dingen/core'
import type { DingenClient } from '../client.js'
import { todayIn } from '../time.js'

/** Logic shared by all importers: CSV reading, stable ids, writing and the report. */

/** RFC 4180: quoted fields may contain commas, quotes ("") and newlines. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface ImportPlan {
  areas: Area[]
  projects: Project[]
  /** Headings inside projects (Todoist sections). Absent for sources without them. */
  headings?: Heading[]
  tags: Tag[]
  tasks: Task[]
  checklist: ChecklistItem[]
  warnings: string[]
  skipped: { closedLists: string[]; tasksInClosedLists: number }
  summary: { area: string | null; project: string | null; open: number; completed: number }[]
}

export function calendarDate(value: string, timezone: string): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  if (Number.isNaN(d.getTime())) return null
  return todayIn(timezone, d)
}

export function isoOrNull(value: string): string | null {
  if (!value) return null
  const d = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function isoOrNow(value: string): string {
  return isoOrNull(value) ?? new Date().toISOString()
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A ULID-shaped id that is the same every time for the same source key. */
export function stableId(key: string): string {
  const hash = createHash('sha256').update(`dingen:${key}`).digest()
  let bits = 0n
  for (const byte of hash.subarray(0, 17)) bits = (bits << 8n) | BigInt(byte)
  let out = ''
  for (let i = 0; i < 26; i += 1) {
    out = CROCKFORD[Number(bits & 31n)] + out
    bits >>= 5n
  }
  // The first character of a ULID is at most '7' (48-bit time); keep it valid for strict parsers.
  return `${CROCKFORD[Number(out.charCodeAt(0)) % 8]}${out.slice(1)}`
}

export interface ImportResult {
  created: Record<EntityType, number>
  alreadyThere: number
}

/**
 * Plan tags that the account already has under the same (lowercase) name and
 * parent map to that tag, so an import never makes a second "werk". Returns
 * plan tag id → the id to use; parents come before their children in a plan.
 */
function existingTagIds(client: DingenClient, tags: Tag[]): Map<string, string> {
  const live = [...client.records.values()].filter((r) => r.entityType === 'tag' && !isDeleted(r))
  const mapped = new Map<string, string>()
  for (const tag of tags) {
    if (client.records.has(`tag:${tag.id}`)) continue
    const parentId = tag.parentId ? (mapped.get(tag.parentId) ?? tag.parentId) : null
    const same = live.find(
      (r) =>
        (r.data.parentId ?? null) === parentId &&
        typeof r.data.title === 'string' &&
        sameTagTitle(r.data.title, tag.title),
    )
    if (same) mapped.set(tag.id, same.id)
  }
  return mapped
}

/** Writes the plan; entities whose id already exists in the replica are left alone. */
export function writePlan(client: DingenClient, plan: ImportPlan): ImportResult {
  const tagIds = existingTagIds(client, plan.tags)
  const tagId = (id: string) => tagIds.get(id) ?? id
  const result: ImportResult = {
    created: { area: 0, project: 0, heading: 0, task: 0, checklistItem: 0, tag: 0, review: 0 },
    alreadyThere: 0,
  }
  const put = (type: EntityType, entity: Entity) => {
    if (client.records.has(`${type}:${entity.id}`)) {
      result.alreadyThere += 1
      return
    }
    client.create(type, entity)
    result.created[type] += 1
  }
  for (const a of plan.areas) put('area', a)
  for (const p of plan.projects) put('project', p)
  for (const h of plan.headings ?? []) put('heading', h)
  for (const t of plan.tags) {
    if (tagIds.has(t.id)) {
      result.alreadyThere += 1
      continue
    }
    put('tag', t.parentId ? { ...t, parentId: tagId(t.parentId) } : t)
  }
  for (const t of plan.tasks) {
    put('task', tagIds.size > 0 ? { ...t, tagIds: [...new Set(t.tagIds.map(tagId))] } : t)
  }
  for (const c of plan.checklist) put('checklistItem', c)
  return result
}

export function describePlan(plan: ImportPlan): string {
  const lines: string[] = []
  lines.push(
    `Areas: ${plan.areas.length}, projects: ${plan.projects.length}, tags: ${plan.tags.length}, tasks: ${plan.tasks.filter((t) => t.repeat === null).length} (${plan.tasks.filter((t) => t.repeat !== null).length} repeating), checklist items: ${plan.checklist.length}`,
  )
  lines.push('')
  const count = (e: { open: number; completed: number }) =>
    `${e.open + e.completed} (${e.open} open, ${e.completed} done)`
  const byArea = new Map<string | null, ImportPlan['summary']>()
  for (const s of plan.summary) byArea.set(s.area, [...(byArea.get(s.area) ?? []), s])
  for (const key of [...plan.areas.map((a) => a.title), null]) {
    const entries = byArea.get(key) ?? []
    if (key === null && entries.length === 0) continue
    const total = entries.reduce(
      (t, e) => ({ open: t.open + e.open, completed: t.completed + e.completed }),
      { open: 0, completed: 0 },
    )
    lines.push(`  ${key ?? '(no area)'}: ${count(total)}`)
    for (const e of entries) lines.push(`    ${e.project ?? 'loose tasks'}: ${count(e)}`)
  }
  if (plan.skipped.closedLists.length > 0) {
    lines.push(
      '',
      `Skipped closed lists: ${plan.skipped.closedLists.join(', ')} (${plan.skipped.tasksInClosedLists} tasks)`,
    )
  }
  if (plan.warnings.length > 0) {
    lines.push('', `Check by hand (${plan.warnings.length}):`)
    for (const w of plan.warnings) lines.push(`  - ${w}`)
  }
  return lines.join('\n')
}

/** Collects areas, projects, headings and tags by name, with the same stable ids as the TickTick import. */
export class PlanBuilder {
  readonly areas = new Map<string, Area>()
  readonly projects = new Map<string, Project>()
  readonly headings = new Map<string, Heading>()
  readonly tags = new Map<string, Tag>()
  private readonly areaOrders = ordersBetween(null, null, 1000)
  private readonly projectOrders = ordersBetween(null, null, 1000)
  private readonly tagOrders = ordersBetween(null, null, 2000)
  private readonly headingOrders = ordersBetween(null, null, 1000)

  area(title: string): Area {
    let a = this.areas.get(title)
    if (!a) {
      a = newArea({
        id: stableId(`area:${title}`),
        title,
        order: this.areaOrders[this.areas.size] ?? 'zz',
      })
      this.areas.set(title, a)
    }
    return a
  }

  /** A project belongs to the area it was first seen in. */
  project(title: string, areaTitle: string | null): Project {
    let p = this.projects.get(title)
    if (!p) {
      p = newProject({
        id: stableId(`project:${title}`),
        title,
        areaId: areaTitle ? this.area(areaTitle).id : null,
        order: this.projectOrders[this.projects.size] ?? 'zz',
      })
      this.projects.set(title, p)
    }
    return p
  }

  heading(projectTitle: string, title: string): Heading {
    const key = `${projectTitle}\u0000${title}`
    let h = this.headings.get(key)
    if (!h) {
      h = newHeading({
        id: stableId(`heading:${key}`),
        title,
        projectId: this.project(projectTitle, null).id,
        order: this.headingOrders[this.headings.size] ?? 'zz',
      })
      this.headings.set(key, h)
    }
    return h
  }

  /** Tags by lowercase name (plan 23); the key also makes the stable id. */
  tag(name: string): Tag {
    const key = normalizeTagTitle(name)
    let t = this.tags.get(key)
    if (!t) {
      t = newTag({
        id: stableId(`tag:${key}`),
        title: name,
        order: this.tagOrders[this.tags.size] ?? 'zz',
      })
      this.tags.set(key, t)
    }
    return t
  }
}

/** Counts per area and project, in the shape the report prints. */
export function summarize(
  tasks: Task[],
  areas: Area[],
  projects: Project[],
  inboxIds: Set<string> = new Set(),
): ImportPlan['summary'] {
  const areaTitle = new Map(areas.map((a) => [a.id, a.title]))
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const rows = new Map<string, ImportPlan['summary'][number]>()
  const bump = (area: string | null, project: string | null, done: boolean) => {
    const key = `${area ?? ''}\u0000${project ?? ''}`
    const row = rows.get(key) ?? { area, project, open: 0, completed: 0 }
    if (done) row.completed += 1
    else row.open += 1
    rows.set(key, row)
  }
  for (const t of tasks) {
    if (t.repeat !== null) continue
    const project = t.projectId ? projectById.get(t.projectId) : undefined
    const area = project ? project.areaId : t.areaId
    const label = project
      ? project.title
      : t.when.kind === 'inbox' || inboxIds.has(t.id)
        ? 'Inbox'
        : null
    bump(area ? (areaTitle.get(area) ?? null) : null, label, t.status !== 'open')
  }
  for (const p of projects) {
    const area = p.areaId ? (areaTitle.get(p.areaId) ?? null) : null
    if (!rows.has(`${area ?? ''}\u0000${p.title}`)) {
      rows.set(`${area ?? ''}\u0000${p.title}`, { area, project: p.title, open: 0, completed: 0 })
    }
  }
  return [...rows.values()]
}

/**
 * A repeating task is a hidden template plus its first visible instance, as
 * in the TickTick import. Returns the tasks (and checklist items) to add.
 */
export function withRepeat(
  task: Task,
  list: ChecklistItem[],
  rule: Repeat,
  today: string,
  key: string,
  order: string,
): { tasks: Task[]; checklist: ChecklistItem[] } | null {
  const first = firstOccurrence(rule, today)
  if (!first) return null
  const template: Task = {
    ...task,
    id: stableId(`template:${key}`),
    repeat: rule,
    when: { kind: 'anytime' },
    deadline: null,
  }
  const instance = {
    ...instanceOf(template, task.when.kind === 'date' ? task.when.date : first, order),
    id: task.id,
    createdAt: task.createdAt,
  }
  const templateList = list.map((item, i) => ({
    ...item,
    id: stableId(`check:${key}:tpl:${i}`),
    taskId: template.id,
    done: false,
  }))
  return { tasks: [template, instance], checklist: [...templateList, ...list] }
}
