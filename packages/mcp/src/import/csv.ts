import { newTask, ordersBetween, type Task, type When } from '@dingen/core'
import { type ImportPlan, PlanBuilder, parseCsv, stableId, summarize } from './common.js'

/**
 * Generic CSV → Dingen. Columns (English, case-insensitive, only title is
 * required): title, notes, project, area, tags, when, deadline, done. Ids come
 * from area, project, title and the position among equal titles, so running
 * the import twice changes nothing the second time.
 */

export interface CsvOptions {
  today: string
  timezone?: string
}

const COLUMNS = ['title', 'notes', 'project', 'area', 'tags', 'when', 'deadline', 'done'] as const
type Column = (typeof COLUMNS)[number]

const DONE = /^(y|yes|true|1|x|done)$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A semicolon-separated file (spreadsheets in many locales) is recognised by its header line. */
function delimiterOf(text: string): string {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''
  return (header.match(/;/g) ?? []).length > (header.match(/,/g) ?? []).length ? ';' : ','
}

export function planCsvImport(text: string, options: CsvOptions): ImportPlan {
  const clean = text.replace(/^﻿/, '')
  const table = parseCsv(clean, delimiterOf(clean))
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase())
  if (!header.includes('title')) {
    throw new Error('Not a Dingen CSV: no "title" column found in the first line')
  }
  const warnings: string[] = []
  const unknown = header.filter((h) => h !== '' && !(COLUMNS as readonly string[]).includes(h))
  if (unknown.length > 0) warnings.push(`Unknown columns ignored: ${unknown.join(', ')}`)
  const col = (name: Column) => header.indexOf(name)

  const body = table
    .slice(1)
    .map((row, i) => ({ row, line: i + 2 }))
    .filter(({ row }) => row.some((c) => c.trim() !== ''))
  const orders = ordersBetween(null, null, Math.max(body.length, 1))
  const builder = new PlanBuilder()
  const tasks: Task[] = []
  const seen = new Map<string, number>()

  body.forEach(({ row, line }, i) => {
    const get = (name: Column) => (col(name) >= 0 ? (row[col(name)] ?? '').trim() : '')
    const title = get('title')
    if (!title) {
      warnings.push(`Line ${line}: no title, row skipped`)
      return
    }
    const area = get('area')
    const project = get('project')
    const projectEntity = project ? builder.project(project, area || null) : null
    // A project in an area keeps the area on the project; only loose tasks carry areaId.
    const areaEntity = area ? builder.area(area) : null

    const rawWhen = get('when').toLowerCase()
    let when: When
    if (!rawWhen) {
      when = project || area ? { kind: 'anytime' } : { kind: 'inbox' }
    } else if (rawWhen === 'today') when = { kind: 'date', date: options.today }
    else if (rawWhen === 'tomorrow') when = { kind: 'date', date: addDays(options.today, 1) }
    else if (rawWhen === 'someday') when = { kind: 'someday' }
    else if (rawWhen === 'anytime') when = { kind: 'anytime' }
    else if (rawWhen === 'inbox') when = { kind: 'inbox' }
    else if (DATE.test(rawWhen) && validDate(rawWhen)) when = { kind: 'date', date: rawWhen }
    else {
      warnings.push(`Line ${line} "${title}": when "${get('when')}" not understood; set to anytime`)
      when = { kind: 'anytime' }
    }
    // A task that belongs somewhere cannot sit in the Inbox.
    if (when.kind === 'inbox' && (project || area)) when = { kind: 'anytime' }

    const rawDeadline = get('deadline')
    let deadline: string | null = null
    if (rawDeadline) {
      if (DATE.test(rawDeadline) && validDate(rawDeadline)) deadline = rawDeadline
      else
        warnings.push(
          `Line ${line} "${title}": deadline "${rawDeadline}" is not YYYY-MM-DD; ignored`,
        )
    }

    const tagIds = get('tags')
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => builder.tag(t).id)

    const done = DONE.test(get('done'))
    const key = `${area}\u0000${project}\u0000${title}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    tasks.push(
      newTask({
        id: stableId(`csv:task:${key}:${n}`),
        title,
        notes: get('notes'),
        status: done ? 'completed' : 'open',
        projectId: projectEntity?.id ?? null,
        areaId: !projectEntity && areaEntity ? areaEntity.id : null,
        when,
        deadline,
        tagIds: [...new Set(tagIds)],
        order: orders[i] ?? 'zz',
        completedAt: done ? new Date().toISOString() : null,
      }),
    )
  })

  const areas = [...builder.areas.values()]
  const projects = [...builder.projects.values()]
  return {
    areas,
    projects,
    tags: [...builder.tags.values()],
    tasks,
    checklist: [],
    warnings,
    skipped: { closedLists: [], tasksInClosedLists: 0 },
    summary: summarize(tasks, areas, projects),
  }
}

function validDate(value: string): boolean {
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
