import { addDays, addMonths, addYears, dayOfMonth, weekdayOf } from './dates.js'
import type { CalendarDate, ChecklistItem, Repeat, Task } from './entities.js'
import { ulid } from './ids.js'
import { compareOrder } from './order.js'

/**
 * Herhaling zoals Things: een verborgen herhalende taak (template) met een
 * regel, en steeds één open exemplaar. Deze functies rekenen alleen; het
 * aanmaken van het exemplaar is een gewone wijziging in de client.
 */

export function isTemplate(task: Task): boolean {
  return task.repeat !== null
}

/** Past `date` in het schema van de regel? Alleen voor `basis: 'schedule'`. */
export function matches(rule: Repeat, date: CalendarDate): boolean {
  if (date < rule.start) return false
  if (rule.until && date > rule.until) return false
  switch (rule.unit) {
    case 'day':
      return daysSince(rule.start, date) % rule.every === 0
    case 'week': {
      const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(rule.start)]
      if (!weekdays.includes(weekdayOf(date))) return false
      return weeksSince(rule.start, date) % rule.every === 0
    }
    case 'month':
      return (
        monthsSince(rule.start, date) % rule.every === 0 &&
        date === addMonths(date, 0, dayOfMonth(rule.start))
      )
    case 'year':
      return (
        monthsSince(rule.start, date) % (12 * rule.every) === 0 &&
        date === addYears(date, 0, dayOfMonth(rule.start))
      )
  }
}

/**
 * Eerste datum in het schema ná `after` die niet vóór `notBefore` ligt;
 * null als de regel is afgelopen. Voor `basis: 'completion'` is `after` de
 * afronddag en telt het interval vanaf daar.
 */
export function nextOccurrence(
  rule: Repeat,
  after: CalendarDate,
  notBefore: CalendarDate,
): CalendarDate | null {
  if (rule.basis === 'completion') {
    const next = addInterval(rule, after)
    return rule.until && next > rule.until ? null : next
  }
  let candidate = after < rule.start ? rule.start : addDays(after, 1)
  if (candidate < notBefore) candidate = notBefore
  // Dagelijks op een stap zoeken is eenvoudig en snel genoeg: hooguit een
  // paar jaar aan dagen voor een jaarlijkse regel.
  for (let i = 0; i < 366 * 4 + 7; i += 1) {
    if (rule.until && candidate > rule.until) return null
    if (matches(rule, candidate)) return candidate
    candidate = addDays(candidate, 1)
  }
  return null
}

export function addInterval(rule: Repeat, date: CalendarDate): CalendarDate {
  switch (rule.unit) {
    case 'day':
      return addDays(date, rule.every)
    case 'week':
      return addDays(date, 7 * rule.every)
    case 'month':
      return addMonths(date, rule.every, dayOfMonth(rule.start))
    case 'year':
      return addYears(date, rule.every, dayOfMonth(rule.start))
  }
}

/** De eerste datum van een nieuwe regel: `start` zelf, of de eerste match erna. */
export function firstOccurrence(rule: Repeat, today: CalendarDate): CalendarDate | null {
  if (rule.basis === 'completion') return rule.start < today ? today : rule.start
  return matches(rule, rule.start) ? rule.start : nextOccurrence(rule, rule.start, today)
}

/** Een nieuw exemplaar van een template op `date`, nog zonder plek (`order`). */
export function instanceOf(template: Task, date: CalendarDate, order: string): Task {
  const deadlineDays = template.repeat?.deadlineDays ?? null
  return {
    ...template,
    id: ulid(),
    createdAt: new Date().toISOString(),
    deleted: false,
    status: 'open',
    completedAt: null,
    repeat: null,
    templateId: template.id,
    when: { kind: 'date', date },
    deadline: deadlineDays === null ? null : addDays(date, deadlineDays),
    order,
    todayOrder: null,
  }
}

/** Een verse kopie van een checklist voor een nieuw exemplaar: alles onafgevinkt. */
export function instanceChecklist(templateItems: ChecklistItem[], taskId: string): ChecklistItem[] {
  return templateItems
    .filter((i) => !i.deleted)
    .sort((a, b) => compareOrder(a.order, b.order))
    .map((i) => ({
      ...i,
      id: ulid(),
      createdAt: new Date().toISOString(),
      taskId,
      done: false,
    }))
}

export interface ChecklistMirror {
  update: { id: string; fields: { title?: string; order?: string } }[]
  create: { title: string; order: string }[]
  remove: string[]
}

/**
 * Wat er aan de checklist van de template moet gebeuren om die van het
 * exemplaar te volgen: op volgorde gematcht, zonder afvinkstatus.
 */
export function checklistMirror(
  templateItems: ChecklistItem[],
  instanceItems: ChecklistItem[],
): ChecklistMirror {
  const sort = (items: ChecklistItem[]) =>
    items.filter((i) => !i.deleted).sort((a, b) => compareOrder(a.order, b.order))
  const tpl = sort(templateItems)
  const inst = sort(instanceItems)
  const plan: ChecklistMirror = { update: [], create: [], remove: [] }
  inst.forEach((item, i) => {
    const target = tpl[i]
    if (!target) {
      plan.create.push({ title: item.title, order: item.order })
      return
    }
    const fields: { title?: string; order?: string } = {}
    if (target.title !== item.title) fields.title = item.title
    if (target.order !== item.order) fields.order = item.order
    if (Object.keys(fields).length > 0) plan.update.push({ id: target.id, fields })
  })
  for (const extra of tpl.slice(inst.length)) plan.remove.push(extra.id)
  return plan
}

function daysSince(start: CalendarDate, date: CalendarDate): number {
  const a = new Date(`${start}T00:00:00Z`).getTime()
  const b = new Date(`${date}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** Weken tussen de maandag van de startweek en die van `date`. */
function weeksSince(start: CalendarDate, date: CalendarDate): number {
  const mondayOf = (d: CalendarDate) => addDays(d, -((weekdayOf(d) + 6) % 7))
  return Math.round(daysSince(mondayOf(start), mondayOf(date)) / 7)
}

function monthsSince(start: CalendarDate, date: CalendarDate): number {
  const [sy, sm] = start.split('-').map(Number) as [number, number]
  const [dy, dm] = date.split('-').map(Number) as [number, number]
  return (dy - sy) * 12 + (dm - sm)
}
