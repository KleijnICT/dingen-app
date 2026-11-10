import { type ImportOptions, listKind, type TickTickRow } from './ticktick.js'

/**
 * TickTick → Dingen, from a JSON dump of TickTick's API (as the TickTick MCP
 * connector returns it). The CSV backup lacks tag parents, closed lists and
 * "repeat after completion"; the API has them. This module only reads the dump
 * into the same rows the CSV path produces, so planTickTickImport keeps
 * owning the mapping rules and the stable ids.
 */

export interface TickTickApiGroup {
  id: string
  name: string
  sortOrder?: number | null
}

export interface TickTickApiProject {
  id: string
  name: string
  sortOrder?: number | null
  closed?: boolean | null
  groupId?: string | null
  kind?: string | null
}

export interface TickTickApiTag {
  /** Lowercase identifier, as used in a task's `tags`. */
  name: string
  label?: string | null
  sortOrder?: number | null
  /** Parent tag name; null or "" means no parent. */
  parent?: string | null
}

export interface TickTickApiItem {
  id?: string
  status?: number | null
  title?: string | null
  sortOrder?: number | null
  completedTime?: string | null
}

export interface TickTickApiTask {
  id: string
  projectId?: string | null
  sortOrder?: number | null
  title?: string | null
  content?: string | null
  desc?: string | null
  startDate?: string | null
  dueDate?: string | null
  timeZone?: string | null
  isAllDay?: boolean | null
  priority?: number | null
  reminders?: string[] | null
  repeatFlag?: string | null
  repeatFrom?: string | null
  completedTime?: string | null
  status?: number | null
  items?: TickTickApiItem[] | null
  tags?: string[] | null
  parentId?: string | null
  kind?: string | null
  createdTime?: string | null
}

export interface TickTickApiList {
  project: TickTickApiProject
  tasks?: TickTickApiTask[] | null
  columns?: unknown[] | null
}

export interface TickTickDump {
  groups?: TickTickApiGroup[] | null
  projects?: TickTickApiProject[] | null
  tags?: TickTickApiTag[] | null
  lists: TickTickApiList[]
}

export interface ConvertedDump {
  rows: TickTickRow[]
  options: Partial<ImportOptions>
}

/** Parses the text of a dump file, with a readable error for the wrong shape. */
export function parseTickTickDump(text: string): TickTickDump {
  const data: unknown = JSON.parse(text.replace(/^﻿/, ''))
  if (typeof data !== 'object' || data === null || !Array.isArray((data as TickTickDump).lists)) {
    throw new Error('Not a TickTick API dump: expected an object with a "lists" array')
  }
  return data as TickTickDump
}

const bySortOrder = (a: number | null | undefined, b: number | null | undefined): number =>
  (a ?? Number.POSITIVE_INFINITY) === (b ?? Number.POSITIVE_INFINITY)
    ? 0
    : (a ?? Number.POSITIVE_INFINITY) < (b ?? Number.POSITIVE_INFINITY)
      ? -1
      : 1

export function convertTickTickDump(dump: TickTickDump): ConvertedDump {
  const notices: string[] = []
  const groups = [...(dump.groups ?? [])].sort((a, b) => bySortOrder(a.sortOrder, b.sortOrder))
  const groupName = new Map(groups.map((g) => [g.id, g.name]))
  const groupIndex = new Map(groups.map((g, i) => [g.id, i]))

  // Lists carry their own project; `projects` may know a few more (empty ones).
  const projects = new Map<string, TickTickApiProject>()
  for (const p of dump.projects ?? []) projects.set(p.id, p)
  for (const l of dump.lists) {
    projects.set(l.project.id, { ...projects.get(l.project.id), ...l.project })
  }

  const nameOf = (p: TickTickApiProject) => (/^inbox/i.test(p.id) ? 'Inbox' : p.name)
  const folderOf = (p: TickTickApiProject) => (p.groupId ? (groupName.get(p.groupId) ?? '') : '')

  const orderedProjects = [...projects.values()].sort(
    (a, b) =>
      (a.groupId ? (groupIndex.get(a.groupId) ?? 1e9) : 1e9) -
        (b.groupId ? (groupIndex.get(b.groupId) ?? 1e9) : 1e9) ||
      bySortOrder(a.sortOrder, b.sortOrder),
  )
  const projectRank = new Map(orderedProjects.map((p, i) => [p.id, i]))

  const entries: { row: TickTickRow; projectId: string }[] = []
  let timeOrReminder = 0
  const seenNames = new Map<string, string>()
  for (const list of dump.lists) {
    const project = list.project
    const closed = project.closed === true
    const folder = folderOf(project)
    const listName = nameOf(project)
    const key = listName.toLowerCase()
    if (!closed && listKind({ folder, list: listName }) === 'project') {
      if (seenNames.has(key) && seenNames.get(key) !== project.id) {
        notices.push(
          `Two lists are named "${listName}"; Dingen ids follow the name, so they are merged into one project`,
        )
      }
      seenNames.set(key, project.id)
    }
    if (!closed && (list.columns ?? []).length > 0) {
      notices.push(`List "${listName}": has kanban columns; the columns were ignored`)
    }
    for (const t of list.tasks ?? []) {
      const open = (t.status ?? 0) === 0
      if (
        !closed &&
        open &&
        ((t.reminders ?? []).length > 0 ||
          (t.isAllDay === false && Boolean(t.startDate || t.dueDate)))
      ) {
        timeOrReminder += 1
      }
      const row = rowFor(t, folder, listName, closed ? [] : notices)
      if (closed) row.listClosed = true
      entries.push({ row, projectId: project.id })
    }
  }
  if (timeOrReminder > 0) {
    notices.push(
      `${timeOrReminder} open tasks had a time of day or reminders; Dingen has dates only, so those were dropped`,
    )
  }

  // Rows in structure order: group, list, then the task's own sort order.
  entries.sort(
    (a, b) =>
      (projectRank.get(a.projectId) ?? 1e9) - (projectRank.get(b.projectId) ?? 1e9) ||
      a.row.order - b.row.order,
  )
  const rows = entries.map((e) => e.row)

  const live = orderedProjects.filter((p) => p.closed !== true)
  const structure: NonNullable<ImportOptions['structure']> = {
    areas: groups.map((g) => g.name),
    projects: live
      .filter((p) => listKind({ folder: folderOf(p), list: nameOf(p) }) === 'project')
      .map((p) => ({ title: nameOf(p), area: folderOf(p) || null })),
  }

  const tags = [...(dump.tags ?? [])].sort((a, b) => bySortOrder(a.sortOrder, b.sortOrder))
  const tagParents: Record<string, string> = {}
  const tagLabels: Record<string, string> = {}
  for (const tag of tags) {
    if (tag.label) tagLabels[tag.name.toLowerCase()] = tag.label
    if (tag.parent) tagParents[tag.name.toLowerCase()] = tag.parent
  }

  return {
    rows,
    options: {
      tagParents,
      tagLabels,
      allTags: tags.map((t) => t.name),
      structure,
      notices,
    },
  }
}

function rowFor(t: TickTickApiTask, folder: string, list: string, notices: string[]): TickTickRow {
  const isChecklist = (t.kind ?? '').toUpperCase() === 'CHECKLIST'
  const content = isChecklist ? t.desc || t.content || '' : (t.content ?? '')
  const items = [...(t.items ?? [])]
    .sort((a, b) => bySortOrder(a.sortOrder, b.sortOrder))
    .map((i) => ({ title: (i.title ?? '').trim(), done: (i.status ?? 0) !== 0 }))
    .filter((i) => i.title)
  const title = t.title ?? ''
  const row: TickTickRow = {
    folder,
    list,
    title,
    kind: isChecklist ? 'CHECKLIST' : 'TEXT',
    tags: t.tags ?? [],
    content,
    isChecklist,
    startDate: t.startDate ?? '',
    dueDate: t.dueDate ?? '',
    repeat: t.repeatFlag ?? '',
    priority: t.priority ?? 0,
    status: t.status ?? 0,
    createdTime: t.createdTime ?? '',
    completedTime: t.completedTime ?? '',
    order: t.sortOrder ?? 0,
    timezone: t.timeZone ?? '',
    taskId: t.id,
    parentId: t.parentId ?? '',
    listClosed: false,
    items,
  }
  if (t.repeatFlag) {
    const from = t.repeatFrom ?? null
    if (from === '1') row.repeatBasis = 'completion'
    else {
      row.repeatBasis = 'schedule'
      if (from !== null && from !== '0' && from !== '2' && (t.status ?? 0) === 0) {
        notices.push(
          `"${title}": repeatFrom "${from}" not understood; imported as repeating on a schedule`,
        )
      }
    }
  }
  return row
}
