import { ACTIVITY_KINDS, type ActivityItem, addDays, type Member } from '@dingen/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActivityFilter, DingenClient } from './client.js'
import { todayIn } from './time.js'

/**
 * `get_activity` (plan 19): who did what, from the Logbook. It reads the
 * activity API directly and never the sync replica, so an agent with a narrow
 * scope can use it too; the server only returns what that agent may read.
 */

const DayInput = z
  .string()
  .describe(
    "'today', 'yesterday', a date YYYY-MM-DD (a whole day, in the user's timezone) or an ISO date-time",
  )

export function registerActivityTool(server: McpServer, client: DingenClient): void {
  server.registerTool(
    'get_activity',
    {
      title: 'Activity (Logbook)',
      description:
        'What happened, newest first: tasks, projects, headings and areas that were added, completed, reopened, changed or deleted, and by whom (you or an agent). Filter on kind, on who did it and on a period. Answers questions like "what did the research agent do yesterday?". For more, call again with `before` set to the `nextBefore` it gives.',
      inputSchema: {
        kinds: z.array(z.enum(ACTIVITY_KINDS)).optional().describe('Only these kinds'),
        who: z
          .string()
          .optional()
          .describe(
            "'owner' (the person whose data it is), 'me' (whoever this connection acts as, usually you the agent), an agent's name, or a member id such as agent:<id>",
          ),
        since: DayInput.optional().describe('From the start of this day (or this instant)'),
        until: DayInput.optional().describe('Up to the end of this day (or this instant)'),
        before: z.number().int().min(1).optional().describe('The nextBefore of an earlier call'),
        limit: z.number().int().min(1).max(100).default(30),
      },
    },
    async (input) => {
      try {
        // Older servers have no member list; names then fall back to ids.
        const members = await client.members().catch(() => [])
        const today = todayIn(client.timezone)
        const filter: ActivityFilter = {
          kinds: input.kinds,
          actor: input.who ? await resolveWho(input.who, members, () => client.me()) : undefined,
          since: input.since ? instant(input.since, today, client.timezone, 'start') : undefined,
          until: input.until ? instant(input.until, today, client.timezone, 'end') : undefined,
          before: input.before,
          limit: input.limit,
        }
        const page = await client.activity(filter)
        const text = formatActivity(page.items, {
          members,
          timezone: client.timezone,
          nameOf: (type, id) => nameFromReplica(client, type, id),
        })
        const more =
          page.nextBefore === null
            ? 'No older activity.'
            : `More: call again with before=${page.nextBefore}.`
        return { content: [{ type: 'text' as const, text: `${text}\n\n${more}` }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
      }
    },
  )
}

/** A member id from 'owner', 'me', a name or an id. */
export async function resolveWho(
  who: string,
  members: Member[],
  me: () => Promise<string>,
): Promise<string> {
  const w = who.trim()
  if (/^(user|agent):/.test(w)) return w
  if (w.toLowerCase() === 'me') return me()
  if (w.toLowerCase() === 'owner') {
    const owner = members.find((m) => m.kind === 'user')
    if (!owner) throw new Error('Cannot tell who the owner is on this server; use a member id')
    return owner.id
  }
  const match = members.find((m) => m.name.toLowerCase() === w.toLowerCase())
  if (!match) {
    const names = members.map((m) => m.name).join(', ')
    throw new Error(`No member called "${w}"${names ? ` (known: ${names})` : ''}`)
  }
  return match.id
}

/** A day (in `timezone`) or an instant as an ISO instant; `end` gives the last moment of a day. */
export function instant(
  input: string,
  today: string,
  timezone: string,
  edge: 'start' | 'end',
): string {
  const day =
    input === 'today'
      ? today
      : input === 'yesterday'
        ? addDays(today, -1)
        : /^\d{4}-\d{2}-\d{2}$/.test(input)
          ? input
          : null
  if (day === null) {
    const ms = Date.parse(input)
    if (Number.isNaN(ms)) throw new Error(`Not a date: "${input}"`)
    return new Date(ms).toISOString()
  }
  const start = startOfDay(day, timezone)
  return new Date(
    edge === 'start' ? start : startOfDay(addDays(day, 1), timezone) - 1,
  ).toISOString()
}

/** Midnight of `day` in `timezone`, as epoch ms. */
function startOfDay(day: string, timezone: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d)
  // Two rounds settle the offset, also on the day the clocks change.
  let ms = guess - offsetMs(guess, timezone)
  ms = guess - offsetMs(ms, timezone)
  return ms
}

function offsetMs(ms: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return asUtc - (ms - (ms % 60_000))
}

/** A title from the replica when it happens to be loaded; never fetches. */
function nameFromReplica(client: DingenClient, type: string, id: string): string | undefined {
  const title = client.records.get(`${type}:${id}`)?.data.title
  return typeof title === 'string' ? title : undefined
}

interface FormatOptions {
  members: Member[]
  timezone: string
  /** Title of a project, area, heading or tag by id, when known. */
  nameOf?: (type: string, id: string) => string | undefined
}

const FIELD_NAMES: Record<string, string> = {
  title: 'title',
  notes: 'notes',
  when: 'when',
  evening: 'evening',
  time: 'time',
  reminder: 'reminder',
  deadline: 'deadline',
  tagIds: 'tags',
  projectId: 'project',
  areaId: 'area',
  headingId: 'heading',
  assigneeId: 'assignee',
  repeat: 'repeat',
  icon: 'icon',
  color: 'colour',
  reviewedAt: 'reviewed',
  order: 'position',
  todayOrder: 'position in Today',
  checklist: 'checklist',
}

/** Logbook lines as text, grouped per day. */
export function formatActivity(items: ActivityItem[], options: FormatOptions): string {
  if (items.length === 0) return 'No activity found.'
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: options.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: options.timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
  const who = (id: string) => {
    const m = options.members.find((x) => x.id === id)
    if (m?.kind === 'user') return 'you'
    return m?.name ?? id
  }
  const lines: string[] = []
  let day = ''
  for (const item of items) {
    const date = new Date(item.at)
    const d = dayFmt.format(date)
    if (d !== day) {
      if (lines.length > 0) lines.push('')
      lines.push(d)
      day = d
    }
    const where = item.container ? ` (${item.container.type} "${item.container.title}")` : ''
    const what = `${item.entityType} "${item.title || 'untitled'}" [${item.entityId}]${where}`
    lines.push(`  ${timeFmt.format(date)}  ${who(item.actor)} ${verb(item, options)} ${what}`)
  }
  return lines.join('\n')
}

function verb(item: ActivityItem, options: FormatOptions): string {
  switch (item.kind) {
    case 'added':
      return 'added'
    case 'deleted':
      return 'deleted'
    case 'reopened':
      return 'reopened'
    case 'completed':
      return item.fields.some((f) => f.field === 'status' && f.to === 'canceled')
        ? 'canceled'
        : 'completed'
    case 'updated': {
      const parts = item.fields.map((f) => {
        const name = FIELD_NAMES[f.field] ?? f.field
        if (
          f.field === 'notes' ||
          f.field === 'checklist' ||
          f.field === 'order' ||
          f.field === 'todayOrder'
        )
          return name
        if (f.field === 'deleted') return 'restored'
        return `${name} from ${value(f.field, f.from, options)} to ${value(f.field, f.to, options)}`
      })
      return `changed ${parts.join('; ')} of`
    }
  }
}

function value(field: string, v: unknown, options: FormatOptions): string {
  if (v === null || v === undefined || v === '') return 'none'
  const ref = (type: string, id: unknown) =>
    typeof id === 'string' ? `"${options.nameOf?.(type, id) ?? id}"` : String(id)
  switch (field) {
    case 'when': {
      const w = v as { kind?: string; date?: string }
      return w.kind === 'date' ? (w.date ?? 'a date') : (w.kind ?? 'none')
    }
    case 'projectId':
      return ref('project', v)
    case 'areaId':
      return ref('area', v)
    case 'headingId':
      return ref('heading', v)
    case 'tagIds':
      return Array.isArray(v) && v.length > 0 ? v.map((id) => ref('tag', id)).join(', ') : 'none'
    case 'assigneeId': {
      const m = options.members.find((x) => x.id === v)
      return m ? m.name : String(v)
    }
    case 'reminder': {
      const r = v as { daysBefore?: number; time?: string }
      return r.daysBefore ? `${r.time}, ${r.daysBefore} day(s) before` : `${r.time}`
    }
    case 'repeat':
      return 'a repeat rule'
    case 'title':
      return `"${String(v)}"`
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}
