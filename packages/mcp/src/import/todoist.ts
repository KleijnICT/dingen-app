import {
  type ChecklistItem,
  newChecklistItem,
  newTask,
  ordersBetween,
  type Repeat,
  type Task,
  type When,
} from '@dingen/core'
import {
  type ImportPlan,
  PlanBuilder,
  parseCsv,
  stableId,
  summarize,
  withRepeat,
} from './common.js'
import { addDays } from './csv.js'

/**
 * Todoist → Dingen, from Todoist's CSV export. Todoist (Settings, Backups)
 * produces a zip with one CSV per project, and every project can also be
 * exported on its own. The project name is the file name, not a column.
 * Columns: TYPE (task, section, note, meta), CONTENT, DESCRIPTION, PRIORITY,
 * INDENT, AUTHOR, RESPONSIBLE, DATE, DATE_LANG, TIMEZONE.
 */

export interface TodoistFile {
  /** File name without folder, with or without ".csv". */
  name: string
  text: string
}

export interface TodoistOptions {
  today: string
  timezone?: string
  /** Put every imported project in this area. */
  area?: string
}

export function projectNameOf(fileName: string): string {
  return (
    fileName
      .replace(/^.*[\\/]/, '')
      .replace(/\.csv$/i, '')
      .replace(/\s*\[\d+\]$/, '')
      .trim() || 'Todoist'
  )
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}
const WEEKDAYS: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 }

const pad = (n: number) => String(n).padStart(2, '0')
function isoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

/** The next time a day-and-month comes around, today included. */
function nextYearless(m: number, d: number, today: string): string | null {
  const year = Number(today.slice(0, 4))
  const this_ = isoDate(year, m, d)
  if (this_ && this_ >= today) return this_
  return isoDate(year + 1, m, d)
}

interface ParsedDate {
  date: string | null
  time: string | null
  recurring: string | null
}

/** Reads a Todoist DATE value: a fixed date (optionally with a time) or an "every …" rule. */
export function parseTodoistDate(value: string, today: string): ParsedDate {
  const text = value.trim()
  if (!text) return { date: null, time: null, recurring: null }
  if (/^every\b/i.test(text)) return { date: null, time: null, recurring: text }
  const timeMatch = text.match(/(?:\bat\s+|[T\s])(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\b/i)
  let time: string | null = null
  if (timeMatch) {
    let h = Number(timeMatch[1])
    if (/pm/i.test(timeMatch[3] ?? '') && h < 12) h += 12
    time = `${pad(h)}:${timeMatch[2]}`
  }
  const rest = text.replace(timeMatch?.[0] ?? '', ' ').trim()
  let m = rest.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return { date: isoDate(Number(m[1]), Number(m[2]), Number(m[3])), time, recurring: null }
  m = rest.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?(?:\s+(\d{4}))?$/)
  if (m && MONTHS[(m[2] ?? '').toLowerCase()]) {
    const mo = MONTHS[(m[2] ?? '').toLowerCase()] as number
    const day = Number(m[1])
    return {
      date: m[3] ? isoDate(Number(m[3]), mo, day) : nextYearless(mo, day, today),
      time,
      recurring: null,
    }
  }
  m = rest.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)
  if (m && MONTHS[(m[1] ?? '').toLowerCase()]) {
    const mo = MONTHS[(m[1] ?? '').toLowerCase()] as number
    const day = Number(m[2])
    return {
      date: m[3] ? isoDate(Number(m[3]), mo, day) : nextYearless(mo, day, today),
      time,
      recurring: null,
    }
  }
  const lower = rest.toLowerCase()
  if (lower === 'today') return { date: today, time, recurring: null }
  if (lower === 'tomorrow') return { date: addDays(today, 1), time, recurring: null }
  return { date: null, time, recurring: null }
}

/** Turns "every …" into a Dingen repeat rule, or null when Dingen cannot express it. */
export function parseTodoistRepeat(
  text: string,
  start: string,
  note: (message: string) => void,
): Repeat | null {
  let body = text.trim().toLowerCase()
  const basis = /^every!/.test(body) ? 'completion' : 'schedule'
  body = body.replace(/^every!?\s*/, '')
  let until: string | null = null
  const ending = body.match(/\s+(?:ending|until)\s+(.*)$/)
  if (ending) {
    body = body.slice(0, ending.index).trim()
    until = parseTodoistDate(ending[1] ?? '', start).date
    if (!until) note('end of the repeat not understood; imported without an end')
  }
  const starting = body.match(/\s+starting\s+.*$/)
  if (starting) {
    body = body.slice(0, starting.index).trim()
    note('"starting" date ignored')
  }
  const forN = body.match(/\s+for\s+\d+\s+\w+$/)
  if (forN) {
    body = body.slice(0, forN.index).trim()
    note('"for N times" ignored; imported without an end')
  }
  body = body.replace(/\s+at\s+\d{1,2}(:\d{2})?\s*(am|pm)?$/, '')
  const rule = (unit: Repeat['unit'], every: number, weekdays: number[] = [], from = start) => ({
    unit,
    every,
    basis: basis as Repeat['basis'],
    weekdays: unit === 'week' ? weekdays : [],
    start: from,
    until,
    deadlineDays: null,
  })
  const units: Record<string, Repeat['unit']> = {
    day: 'day',
    days: 'day',
    week: 'week',
    weeks: 'week',
    month: 'month',
    months: 'month',
    year: 'year',
    years: 'year',
  }
  let m = body.match(/^(?:(other)|(\d+))?\s*(days?|weeks?|months?|years?)$/)
  if (m) {
    return rule(units[m[3] ?? 'day'] ?? 'day', m[1] ? 2 : Number(m[2] ?? 1))
  }
  if (/^(work ?days?|weekdays?)$/.test(body)) return rule('week', 1, [1, 2, 3, 4, 5])
  if (/^weekends?$/.test(body)) return rule('week', 1, [6, 0])
  const names = body.split(/\s*(?:,|\band\b)\s*/).filter(Boolean)
  const days = names.map((n) => WEEKDAYS[n.slice(0, 2)])
  if (
    names.length > 0 &&
    names.every((n, i) => /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/.test(n) && days[i] !== undefined)
  ) {
    return rule('week', 1, [...new Set(days as number[])].sort())
  }
  m = body.match(/^(\d{1,2})(?:st|nd|rd|th)(?:\s+day)?$/)
  if (m) {
    const day = Number(m[1])
    const [y, mo] = start.split('-').map(Number) as [number, number, number]
    const thisMonth = isoDate(y, mo, day)
    const from =
      thisMonth && thisMonth >= start
        ? thisMonth
        : isoDate(mo === 12 ? y + 1 : y, (mo % 12) + 1, day)
    if (!from) {
      note(`repeat day ${day} does not exist every month; kept as plain monthly`)
      return rule('month', 1)
    }
    return rule('month', 1, [], from)
  }
  m = body.match(/^(?:([a-z]{3})[a-z]*\s+(\d{1,2})|(\d{1,2})\s+([a-z]{3})[a-z]*)$/)
  if (m) {
    const mo = MONTHS[m[1] ?? m[4] ?? '']
    const day = Number(m[2] ?? m[3])
    const from = mo ? nextYearless(mo, day, start) : null
    if (from) return rule('year', 1, [], from)
  }
  note(`repeat "${text}" not understood; imported without repeat`)
  return null
}

interface Row {
  type: string
  content: string
  description: string
  indent: number
  date: string
}

function readRows(text: string): Row[] {
  const table = parseCsv(text.replace(/^﻿/, ''))
  const header = (table[0] ?? []).map((h) => h.trim().toUpperCase())
  if (!header.includes('TYPE') || !header.includes('CONTENT')) {
    throw new Error('Not a Todoist export: no TYPE and CONTENT header found')
  }
  const col = (n: string) => header.indexOf(n)
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')
  return table
    .slice(1)
    .filter((row) => row.some((c) => c.trim() !== ''))
    .map((row) => ({
      type: get(row, col('TYPE')).toLowerCase(),
      content: get(row, col('CONTENT')),
      description: get(row, col('DESCRIPTION')),
      indent: Number(get(row, col('INDENT')) || 1) || 1,
      date: get(row, col('DATE')),
    }))
}

interface Pending {
  row: Row
  headingId: string | null
  notes: string[]
  subtasks: string[]
}

export function planTodoistImport(files: TodoistFile[], options: TodoistOptions): ImportPlan {
  const warnings: string[] = []
  const builder = new PlanBuilder()
  const tasks: Task[] = []
  const checklist: ChecklistItem[] = []
  if (options.area) builder.area(options.area)
  const seen = new Map<string, number>()
  const times: string[] = []
  const inboxIds = new Set<string>()

  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const project = projectNameOf(file.name)
    const inbox = project.toLowerCase() === 'inbox'
    const projectEntity = inbox ? null : builder.project(project, options.area ?? null)
    const rows = readRows(file.text)
    const orders = ordersBetween(null, null, Math.max(rows.length, 1))

    // Pass 1: group rows into top-level tasks with their notes and subtasks.
    const pending: Pending[] = []
    let headingId: string | null = null
    let flattened = false
    for (const row of rows) {
      if (row.type === 'section') {
        if (inbox)
          warnings.push(`Inbox: section "${row.content}" ignored (the Inbox has no headings)`)
        else headingId = builder.heading(project, row.content).id
      } else if (row.type === 'note') {
        const last = pending[pending.length - 1]
        if (last) last.notes.push(row.content)
        else warnings.push(`${project}: comment "${row.content.slice(0, 40)}" has no task; skipped`)
      } else if (row.type === 'task') {
        const last = pending[pending.length - 1]
        if (row.indent > 1 && last) {
          if (row.indent > 2) flattened = true
          last.subtasks.push(row.content)
          if (row.description || row.date) {
            warnings.push(
              `${project}: subtask "${row.content}" had notes or a date; only its title was kept`,
            )
          }
        } else {
          pending.push({
            row,
            headingId,
            notes: row.description ? [row.description] : [],
            subtasks: [],
          })
        }
      }
      // "meta" rows (view settings) and anything else carry no tasks.
    }
    if (flattened) warnings.push(`${project}: subtasks deeper than one level were flattened`)

    // Pass 2: build tasks.
    pending.forEach((p, i) => {
      const { row } = p
      const key = `${project}\u0000${row.content}`
      const n = seen.get(key) ?? 0
      seen.set(key, n + 1)
      const parsed = parseTodoistDate(row.date, options.today)
      if (row.date && !parsed.date && !parsed.recurring) {
        warnings.push(
          `${project} "${row.content}": date "${row.date}" not understood; imported without date`,
        )
      }
      if (parsed.time) times.push(row.content)
      const when: When = parsed.date
        ? { kind: 'date', date: parsed.date }
        : inbox
          ? { kind: 'inbox' }
          : { kind: 'anytime' }
      const task = newTask({
        id: stableId(`todoist:task:${key}:${n}`),
        title: row.content,
        notes: p.notes.join('\n\n'),
        projectId: projectEntity?.id ?? null,
        headingId: p.headingId,
        when,
        order: orders[i] ?? 'zz',
      })
      const itemOrders = ordersBetween(null, null, Math.max(p.subtasks.length, 1))
      const items = p.subtasks.map((title, j) =>
        newChecklistItem({
          id: stableId(`check:todoist:${key}:${n}:${j}`),
          taskId: task.id,
          title,
          order: itemOrders[j] ?? 'zz',
        }),
      )
      const rule = parsed.recurring
        ? parseTodoistRepeat(parsed.recurring, parsed.date ?? options.today, (message) =>
            warnings.push(`${project} "${row.content}": ${message}`),
          )
        : null
      if (rule) {
        if (/\bat\s+\d/i.test(parsed.recurring ?? '')) times.push(row.content)
        const pair = withRepeat(
          { ...task, repeat: rule },
          items,
          rule,
          options.today,
          `todoist:${key}:${n}`,
          task.order,
        )
        if (pair) {
          tasks.push(...pair.tasks)
          checklist.push(...pair.checklist)
          if (inbox) inboxIds.add(task.id)
          return
        }
      }
      tasks.push(task)
      checklist.push(...items)
      if (inbox) inboxIds.add(task.id)
    })
  }
  if (times.length > 0) {
    warnings.push(
      `${times.length} tasks had a time of day, which Dingen does not keep yet: ${times.slice(0, 5).join(', ')}${times.length > 5 ? ', …' : ''}`,
    )
  }
  const areas = [...builder.areas.values()]
  const projects = [...builder.projects.values()]
  return {
    areas,
    projects,
    headings: [...builder.headings.values()],
    tags: [],
    tasks,
    checklist,
    warnings,
    skipped: { closedLists: [], tasksInClosedLists: 0 },
    summary: summarize(tasks, areas, projects, inboxIds),
  }
}
