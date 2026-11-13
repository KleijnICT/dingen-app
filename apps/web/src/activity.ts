import {
  type ActivityItem,
  type Member,
  SYSTEM_ACTOR,
  toCalendarDate,
  type When,
} from '@dingen/core'
import type { ActivityPage } from './api.js'
import { type MessageKey, t } from './i18n/index.js'
import { addDays, describeDate, describeWhen } from './lists.js'
import type { Workspace } from './store/context.js'

/** The Logbook as activity overview (plan 19): the text of a line and the paging. */

/** What the kind chips filter on; `completed` shows the list of completed items instead. */
export type KindFilter = 'all' | 'added' | 'completed' | 'updated' | 'deleted'
export const KIND_FILTERS: KindFilter[] = ['all', 'added', 'completed', 'updated', 'deleted']

/** `updated` includes reopening and moving: changes to something that already existed. */
export function kindsFor(filter: KindFilter): ActivityItem['kind'][] | undefined {
  if (filter === 'all') return undefined
  if (filter === 'updated') return ['updated', 'reopened', 'moved']
  return [filter]
}

export type PeriodFilter = 'all' | 'today' | 'week' | 'month'
export const PERIOD_FILTERS: PeriodFilter[] = ['all', 'today', 'week', 'month']

/** The start of the period as an instant: local midnight of the first day. */
export function sinceFor(period: PeriodFilter, today: string): string | undefined {
  if (period === 'all') return undefined
  const days = period === 'today' ? 0 : period === 'week' ? 6 : 29
  const [y, m, d] = addDays(today, -days).split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).toISOString()
}

/** Lines per local day, newest day first (the items already come newest first). */
export function groupByDay(items: ActivityItem[]): { date: string; items: ActivityItem[] }[] {
  const groups: { date: string; items: ActivityItem[] }[] = []
  for (const item of items) {
    const date = toCalendarDate(new Date(item.at))
    const last = groups.at(-1)
    if (last && last.date === date) last.items.push(item)
    else groups.push({ date, items: [item] })
  }
  return groups
}

/**
 * Puts a fresh first page on top of what is loaded. Lines are runs of the log
 * cut at fixed places, so everything older than the fresh page's cursor is
 * still right and stays, together with the cursor that continues it.
 */
export function mergeFresh(
  fresh: ActivityPage,
  loaded: ActivityItem[],
  loadedNext: number | null,
): ActivityPage {
  if (fresh.nextBefore === null) return fresh
  const boundary = fresh.nextBefore
  const older = loaded.filter((i) => i.seq < boundary)
  if (older.length === 0) return fresh
  return { items: [...fresh.items, ...older], nextBefore: loadedNext }
}

/** The name in a line: "You" for the signed-in user, else the member's name. */
export function actorName(actor: string, me: string, member: Member | undefined): string {
  if (actor === me) return t('activity.you')
  if (actor === SYSTEM_ACTOR) return t('activity.system')
  return member?.name ?? actor.replace(/^(user|agent):/, '')
}

const DESCRIBED = new Set([
  'title',
  'when',
  'deadline',
  'evening',
  'time',
  'tagIds',
  'projectId',
  'areaId',
  'headingId',
  'assigneeId',
])

/** The words after the name: "added", or "changed When from Today to Friday". */
export function describeLine(
  item: ActivityItem,
  name: string,
  ctx: { ws: Workspace; memberName: (id: string) => string | undefined },
): string {
  switch (item.kind) {
    case 'added':
      return t('activity.line.added', { name })
    case 'deleted':
      return t('activity.line.deleted', { name })
    case 'reopened':
      return t('activity.line.reopened', { name })
    case 'moved': {
      const personal = item.fields.some((f) => f.field === 'space' && f.to === 'personal')
      return t(personal ? 'activity.line.movedPersonal' : 'activity.line.movedShared', { name })
    }
    case 'completed': {
      const canceled = item.fields.some((f) => f.field === 'status' && f.to === 'canceled')
      return t(canceled ? 'activity.line.canceled' : 'activity.line.completed', { name })
    }
    case 'updated': {
      if (item.fields.some((f) => f.field === 'deleted' && f.to === false)) {
        return t('activity.line.restored', { name })
      }
      const parts = item.fields.map((f) => {
        const field = fieldLabel(f.field)
        if (!DESCRIBED.has(f.field)) return field
        return t('activity.change.fromTo', {
          field,
          from: valueText(f.field, f.from, ctx),
          to: valueText(f.field, f.to, ctx),
        })
      })
      return t('activity.line.changed', { name, changes: joinList(parts) })
    }
  }
}

function fieldLabel(field: string): string {
  const key = `activity.field.${field}` as MessageKey
  const text = t(key)
  return text === key || text === undefined ? t('activity.field.other') : text
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  const head = parts.slice(0, -1).join(', ')
  return t('activity.and', { a: head, b: parts.at(-1) as string })
}

function valueText(
  field: string,
  value: unknown,
  ctx: { ws: Workspace; memberName: (id: string) => string | undefined },
): string {
  if (value === null || value === undefined || value === '') return t('activity.none')
  const { ws } = ctx
  switch (field) {
    case 'title':
      return `“${String(value)}”`
    case 'when':
      return describeWhen(value as When, ws.today)
    case 'deadline':
      return typeof value === 'string' ? describeDate(value, ws.today) : t('activity.none')
    case 'evening':
      return value ? t('activity.yes') : t('activity.no')
    case 'projectId':
      return ws.projectById.get(String(value))?.title || t('activity.untitled')
    case 'areaId':
      return ws.areaById.get(String(value))?.title || t('activity.untitled')
    case 'headingId':
      return ws.headingById.get(String(value))?.title || t('activity.untitled')
    case 'tagIds': {
      const ids = Array.isArray(value) ? value : []
      if (ids.length === 0) return t('activity.none')
      return ids.map((id) => ws.tagById.get(String(id))?.title ?? '?').join(', ')
    }
    case 'assigneeId':
      return ctx.memberName(String(value)) ?? t('activity.none')
    default:
      return String(value)
  }
}
