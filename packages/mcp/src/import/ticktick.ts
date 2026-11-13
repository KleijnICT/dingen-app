import {
  type Area,
  type ChecklistItem,
  firstOccurrence,
  instanceOf,
  newArea,
  newChecklistItem,
  newProject,
  newTag,
  newTask,
  normalizeTagTitle,
  ordersBetween,
  type Project,
  type Repeat,
  type Tag,
  type Task,
  type When,
} from '@dingen/core'
import { todayIn } from '../time.js'
import {
  calendarDate,
  describePlan,
  type ImportPlan,
  type ImportResult,
  isoOrNow,
  isoOrNull,
  parseCsv,
  stableId,
  writePlan,
} from './common.js'

/**
 * TickTick → Dingen, from TickTick's CSV backup. The mapping follows how
 * Martien uses TickTick for GTD: folders are areas, "… algemeen" lists hold
 * the loose tasks of an area, other lists are projects, priority 5 marks a
 * real deadline. Ids are derived from TickTick ids, so running the import
 * twice changes nothing the second time.
 */

export interface TickTickRow {
  folder: string
  list: string
  title: string
  kind: string
  tags: string[]
  content: string
  isChecklist: boolean
  startDate: string
  dueDate: string
  repeat: string
  priority: number
  status: number
  createdTime: string
  completedTime: string
  order: number
  timezone: string
  taskId: string
  parentId: string
  /** Lists TickTick marks as closed show up here; the export has no column for it. */
  listClosed: boolean
  /** Structured checklist items (API path). When present, `content` is not scanned for items. */
  items?: { title: string; done: boolean }[]
  /** Known repeat basis (API path). Absent means the source did not say. */
  repeatBasis?: 'schedule' | 'completion'
}

export function parseTickTickCsv(text: string): TickTickRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const headerIndex = lines.findIndex((l) => /^"?Folder Name"?,/.test(l))
  if (headerIndex < 0) throw new Error('Not a TickTick backup: no "Folder Name" header found')
  const table = parseCsv(lines.slice(headerIndex).join('\n'))
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name.toLowerCase())
  const idx = {
    folder: col('Folder Name'),
    list: col('List Name'),
    title: col('Title'),
    kind: col('Kind'),
    tags: col('Tags'),
    content: col('Content'),
    isChecklist: col('Is Check list'),
    startDate: col('Start Date'),
    dueDate: col('Due Date'),
    repeat: col('Repeat'),
    priority: col('Priority'),
    status: col('Status'),
    createdTime: col('Created Time'),
    completedTime: col('Completed Time'),
    order: col('Order'),
    timezone: col('Timezone'),
    taskId: col('taskId'),
    parentId: col('parentId'),
  }
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')
  return table
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => ({
      folder: get(row, idx.folder),
      list: get(row, idx.list),
      title: get(row, idx.title),
      kind: get(row, idx.kind).toUpperCase(),
      tags: get(row, idx.tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      content: get(row, idx.content),
      isChecklist: /^(y|true|1)/i.test(get(row, idx.isChecklist)),
      startDate: get(row, idx.startDate),
      dueDate: get(row, idx.dueDate),
      repeat: get(row, idx.repeat),
      priority: Number(get(row, idx.priority) || 0),
      status: Number(get(row, idx.status) || 0),
      createdTime: get(row, idx.createdTime),
      completedTime: get(row, idx.completedTime),
      order: Number(get(row, idx.order) || 0),
      timezone: get(row, idx.timezone),
      taskId: get(row, idx.taskId),
      parentId: get(row, idx.parentId),
      listClosed: false,
    }))
}

export interface ImportOptions {
  today: string
  /**
   * Tag name → parent tag name. Both are TickTick tag names (the lowercase
   * identifier, as in a task's tags), matched case-insensitively. The CSV
   * export has no tag hierarchy, so the CSV path takes this from a file.
   */
  tagParents?: Record<string, string>
  /** Tag name (lowercase) → display title. Without an entry the name itself is the title. */
  tagLabels?: Record<string, string>
  /** Tag names to create even when no task uses them, in display order. */
  allTags?: string[]
  /** Areas and projects to create even when they hold no tasks, in display order. */
  structure?: { areas: string[]; projects: { title: string; area: string | null }[] }
  /** Warnings from the source reader, listed before the planner's own. */
  notices?: string[]
  /** Names of lists that are closed in TickTick; they are skipped. */
  closedLists?: string[]
  timezone?: string
}

export function planTickTickImport(rows: TickTickRow[], options: ImportOptions): ImportPlan {
  const warnings: string[] = [...(options.notices ?? [])]
  const closed = new Set((options.closedLists ?? []).map(normalize))
  const timezone = options.timezone ?? rows.find((r) => r.timezone)?.timezone ?? 'Europe/Amsterdam'

  const live = rows.filter((r) => !closed.has(normalize(r.list)) && !r.listClosed)
  const skippedTasks = rows.length - live.length

  // Structure: areas from folders, projects from lists.
  const areas = new Map<string, Area>()
  const projects = new Map<string, Project>()
  const projectAreaTitle = new Map<string, string | null>()
  const areaOrders = ordersBetween(null, null, 1000)
  const projectOrders = ordersBetween(null, null, 1000)
  let areaN = 0
  let projectN = 0
  const ensureArea = (folder: string) => {
    if (!folder || areas.has(folder)) return
    areas.set(
      folder,
      newArea({
        id: stableId(`area:${folder}`),
        title: folder,
        order: areaOrders[areaN++] ?? 'zz',
      }),
    )
  }
  const ensureProject = (list: string, folder: string) => {
    if (projects.has(list)) return
    projectAreaTitle.set(list, folder || null)
    projects.set(
      list,
      newProject({
        id: stableId(`project:${list}`),
        title: list,
        areaId: folder ? (areas.get(folder)?.id ?? null) : null,
        order: projectOrders[projectN++] ?? 'zz',
      }),
    )
  }
  for (const a of options.structure?.areas ?? []) ensureArea(a)
  for (const p of options.structure?.projects ?? []) {
    ensureArea(p.area ?? '')
    ensureProject(p.title, p.area ?? '')
  }
  for (const r of live) {
    ensureArea(r.folder)
    if (listKind(r) === 'project') ensureProject(r.list, r.folder)
  }

  // Tags by name (case-insensitive); parents and labels from the options. The
  // titles become lowercase (plan 23), labels included.
  const tags = new Map<string, Tag>()
  const tagOrders = ordersBetween(null, null, 2000)
  const parentOf = new Map(
    Object.entries(options.tagParents ?? {}).map(([k, v]) => [normalizeTagTitle(k), v]),
  )
  const labelOf = new Map(
    Object.entries(options.tagLabels ?? {}).map(([k, v]) => [normalizeTagTitle(k), v]),
  )
  const resolving = new Set<string>()
  const tagFor = (name: string): Tag => {
    const key = normalizeTagTitle(name)
    const existing = tags.get(key)
    if (existing) return existing
    const parentName = parentOf.get(key)
    let parent: Tag | null = null
    if (parentName && !resolving.has(key)) {
      resolving.add(key)
      parent = tagFor(parentName)
      resolving.delete(key)
    }
    const existingNow = tags.get(key)
    if (existingNow) return existingNow
    const tag = newTag({
      id: stableId(`tag:${key}`),
      title: labelOf.get(key) ?? name,
      parentId: parent?.id ?? null,
      order: tagOrders[tags.size] ?? 'zz',
    })
    tags.set(key, tag)
    return tag
  }
  for (const name of options.allTags ?? []) tagFor(name)

  // Tasks: subtasks become checklist items of their parent.
  const byId = new Map(live.map((r) => [r.taskId, r]))
  const children = new Map<string, TickTickRow[]>()
  for (const r of live) {
    if (r.parentId && byId.has(r.parentId)) {
      children.set(r.parentId, [...(children.get(r.parentId) ?? []), r])
    }
  }
  const topLevel = live.filter((r) => !(r.parentId && byId.has(r.parentId)))

  const tasks: Task[] = []
  const checklist: ChecklistItem[] = []
  const groups = new Map<string, TickTickRow[]>()
  for (const r of topLevel) {
    const key = `${r.folder}\u0000${r.list}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const summary: ImportPlan['summary'] = []
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.order - b.order)
    const orders = ordersBetween(null, null, sorted.length)
    let open = 0
    let completed = 0
    sorted.forEach((r, i) => {
      const task = taskFor(r, orders[i] ?? 'a0')
      tasks.push(...task.tasks)
      checklist.push(...task.checklist)
      if (r.status === 0) open += 1
      else completed += 1
    })
    const first = sorted[0]
    if (first) {
      const kind = listKind(first)
      summary.push({
        area: first.folder || null,
        project:
          kind === 'project'
            ? first.list
            : kind === 'inbox'
              ? 'Inbox'
              : kind === 'someday'
                ? 'Someday'
                : null,
        open,
        completed,
      })
    }
  }

  // Projects without tasks still show up in the report, so counts can be compared.
  for (const [title, areaTitle] of projectAreaTitle) {
    if (!summary.some((s) => s.project === title && s.area === areaTitle)) {
      summary.push({ area: areaTitle, project: title, open: 0, completed: 0 })
    }
  }

  function taskFor(r: TickTickRow, order: string): { tasks: Task[]; checklist: ChecklistItem[] } {
    const kind = listKind(r)
    const project = kind === 'project' ? projects.get(r.list) : undefined
    const area = kind === 'area' && r.folder ? areas.get(r.folder) : undefined
    const zone = r.timezone || timezone
    const start = calendarDate(r.startDate, zone)
    const due = calendarDate(r.dueDate, zone)
    const hardDeadline = r.priority === 5 && due !== null
    const plannedDay = hardDeadline && start === due ? null : (start ?? (hardDeadline ? null : due))
    let when: When
    if (kind === 'inbox') when = { kind: 'inbox' }
    else if (kind === 'someday') when = { kind: 'someday' }
    else if (plannedDay) when = { kind: 'date', date: plannedDay }
    else when = { kind: 'anytime' }
    if (kind === 'inbox' && plannedDay) when = { kind: 'date', date: plannedDay }

    const { notes, items } = r.items
      ? { notes: r.content.trim(), items: r.items.filter((i) => i.title) }
      : splitContent(r)
    if (r.kind === 'NOTE')
      warnings.push(`"${r.title}": was a note in TickTick, imported as a task with notes`)
    const status = r.status === 0 ? 'open' : r.status === -1 ? 'canceled' : 'completed'
    const task = newTask({
      id: stableId(`task:${r.taskId || r.title}`),
      title: r.title,
      notes,
      status,
      projectId: project?.id ?? null,
      areaId: area?.id ?? null,
      when,
      deadline: hardDeadline ? due : null,
      tagIds: r.tags.map((t) => tagFor(t).id),
      order,
      createdAt: isoOrNow(r.createdTime),
      completedAt:
        status === 'open' ? null : (isoOrNull(r.completedTime) ?? isoOrNow(r.createdTime)),
    })

    const list: ChecklistItem[] = []
    const subtasks = [...(children.get(r.taskId) ?? [])].sort((a, b) => a.order - b.order)
    const all: { title: string; done: boolean; row?: TickTickRow }[] = [
      ...items,
      ...subtasks.map((s) => ({ title: s.title, done: s.status !== 0, row: s })),
    ]
    const itemOrders = ordersBetween(null, null, all.length)
    all.forEach((item, i) => {
      list.push(
        newChecklistItem({
          id: stableId(`check:${r.taskId}:${item.row ? item.row.taskId : i}`),
          taskId: task.id,
          title: item.title,
          done: item.done,
          order: itemOrders[i] ?? 'a0',
        }),
      )
      if (item.row && (item.row.content || item.row.startDate || item.row.tags.length > 0)) {
        warnings.push(
          `"${r.title}": subtask "${item.title}" had notes, dates or tags; only its title was kept`,
        )
      }
    })

    const rule =
      status === 'open'
        ? repeatRule(
            r.repeat,
            when.kind === 'date' ? when.date : options.today,
            warnings,
            r.title,
            r.repeatBasis,
          )
        : null
    if (!rule) return { tasks: [task], checklist: list }
    const first = firstOccurrence(rule, options.today)
    if (!first) return { tasks: [task], checklist: list }
    const template: Task = {
      ...task,
      id: stableId(`template:${r.taskId}`),
      repeat: rule,
      when: { kind: 'anytime' },
      deadline: null,
    }
    const instance = {
      // An overdue repeating task stays on its own date, as it was in TickTick.
      ...instanceOf(template, when.kind === 'date' ? when.date : first, order),
      id: task.id,
      createdAt: task.createdAt,
    }
    const templateList = list.map((item, i) => ({
      ...item,
      id: stableId(`check:${r.taskId}:tpl:${i}`),
      taskId: template.id,
      done: false,
    }))
    return { tasks: [template, instance], checklist: [...templateList, ...list] }
  }

  return {
    areas: [...areas.values()],
    projects: [...projects.values()],
    tags: [...tags.values()],
    tasks,
    checklist,
    warnings,
    skipped: {
      closedLists: [
        ...new Set([
          ...(options.closedLists ?? []),
          ...rows.filter((r) => r.listClosed).map((r) => r.list),
        ]),
      ],
      tasksInClosedLists: skippedTasks,
    },
    summary,
  }
}

export function listKind(
  r: Pick<TickTickRow, 'folder' | 'list'>,
): 'inbox' | 'someday' | 'area' | 'project' {
  const list = normalize(r.list)
  if (list === 'inbox' || list === '') return 'inbox'
  if (list === 'someday') return 'someday'
  if (r.folder && list.endsWith('algemeen')) return 'area'
  return 'project'
}

/** Lowercase letters and digits only, so "💰Financien" and "Financien" match. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function splitContent(r: TickTickRow): {
  notes: string
  items: { title: string; done: boolean }[]
} {
  const items: { title: string; done: boolean }[] = []
  const notes: string[] = []
  for (const line of r.content.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:([▫▪])|-\s*\[( |x|X)\])\s*(.*)$/u)
    if (m && (r.isChecklist || r.kind === 'CHECKLIST' || m[2] !== undefined)) {
      items.push({ title: (m[3] ?? '').trim(), done: m[1] === '▪' || /x/i.test(m[2] ?? '') })
    } else notes.push(line)
  }
  return { notes: notes.join('\n').trim(), items: items.filter((i) => i.title) }
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function repeatRule(
  rrule: string,
  start: string,
  warnings: string[],
  title: string,
  knownBasis?: 'schedule' | 'completion',
): Repeat | null {
  if (!rrule) return null
  const body = rrule.replace(/^RRULE:/i, '')
  const parts = Object.fromEntries(
    body.split(';').map((p) => {
      const [k, v] = p.split('=')
      return [(k ?? '').toUpperCase(), v ?? '']
    }),
  )
  const freq = parts.FREQ
  const unit =
    freq === 'DAILY'
      ? 'day'
      : freq === 'WEEKLY'
        ? 'week'
        : freq === 'MONTHLY'
          ? 'month'
          : freq === 'YEARLY'
            ? 'year'
            : null
  if (!unit) {
    warnings.push(`"${title}": repeat rule "${rrule}" not understood; imported without repeat`)
    return null
  }
  const weekdays = (parts.BYDAY ?? '')
    .split(',')
    .map((d) => WEEKDAYS[d.replace(/^[+-]?\d+/, '')])
    .filter((d): d is number => d !== undefined)
  // "Every year on 12 March" is what a plain yearly rule from 12 March already
  // does; only a day that differs from the start date loses something.
  const sameDay =
    Number(parts.BYMONTHDAY) === Number(start.slice(8, 10)) &&
    (!parts.BYMONTH || Number(parts.BYMONTH) === Number(start.slice(5, 7)))
  if (
    (parts.BYMONTHDAY && !sameDay) ||
    parts.BYSETPOS ||
    /^[+-]?\d+[A-Z]{2}/.test(parts.BYDAY ?? '')
  ) {
    warnings.push(
      `"${title}": repeat "${rrule}" uses a day rule Dingen lacks; kept as plain ${unit}ly`,
    )
  }
  if (parts.COUNT)
    warnings.push(`"${title}": repeat with COUNT=${parts.COUNT} imported without an end`)
  if (!knownBasis) {
    warnings.push(
      `"${title}": repeats ${unit}ly on a schedule; check whether it should be "after completion"`,
    )
  }
  const until = parts.UNTIL
    ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`
    : null
  return {
    unit,
    every: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    basis: knownBasis ?? 'schedule',
    weekdays: unit === 'week' ? weekdays : [],
    start,
    until,
    deadlineDays: null,
  }
}

export function defaultToday(timezone = 'Europe/Amsterdam'): string {
  return todayIn(timezone)
}

export { describePlan, type ImportPlan, type ImportResult, stableId }
/** Writes the plan; entities whose id already exists in the replica are left alone. */
export const importTickTick = writePlan
