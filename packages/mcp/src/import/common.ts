import { createHash } from 'node:crypto'
import type { Area, ChecklistItem, Entity, EntityType, Project, Tag, Task } from '@dingen/core'
import type { DingenClient } from '../client.js'
import { todayIn } from '../time.js'

/** Logic shared by all importers: CSV reading, stable ids, writing and the report. */

/** RFC 4180: quoted fields may contain commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
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
    else if (ch === ',') {
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

/** Writes the plan; entities whose id already exists in the replica are left alone. */
export function writePlan(client: DingenClient, plan: ImportPlan): ImportResult {
  const result: ImportResult = {
    created: { area: 0, project: 0, heading: 0, task: 0, checklistItem: 0, tag: 0 },
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
  for (const t of plan.tags) put('tag', t)
  for (const t of plan.tasks) put('task', t)
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
