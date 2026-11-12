import {
  type AgentGrant,
  addDays,
  type Change,
  formatTimestamp,
  type MemberId,
  newTask,
  orderBetween,
  ulid,
} from '@dingen/core'
import type { ImportRecord } from '../sync.js'
import type { DemoContext } from './book.js'
import { zonedIso } from './time.js'

/** A demo agent of Sam's: what the seed writes to `agents` and `agent_grants`. */
export interface DemoAgent {
  id: string
  name: string
  icon: string
  color: string
  grants: AgentGrant[]
}

/** One change in the demo story, by Sam or one of the agents, at an instant in the past. */
export interface DemoAction {
  actor: MemberId
  at: string
  change: Change
}

const MINUTE = 60_000

/**
 * Sam's two agents and a few days of their work, on top of Sam's demo set:
 * Sam hands tasks to the agents, the agents add, update and complete tasks
 * within their scope. Every action goes through the normal push with its
 * actor's grants, so the demo cannot contain a change an agent could not make.
 */
export function samAgents(
  ctx: DemoContext,
  samId: string,
  records: ImportRecord[],
): { agents: DemoAgent[]; actions: DemoAction[] } {
  const find = (type: string, title: string) => {
    const r = records.find((x) => x.entityType === type && x.data.title === title)
    if (!r) throw new Error(`Demo ${type} not found: ${title}`)
    return r
  }
  const vat = find('project', 'Q4 VAT return')
  const business = find('area', 'Business')
  const errands = find('tag', 'Errands')

  const research: DemoAgent = {
    id: ulid(),
    name: 'Research assistant',
    icon: 'bot',
    color: 'indigo',
    grants: [{ scope: 'all', level: 'edit' }],
  }
  const bookkeeper: DemoAgent = {
    id: ulid(),
    name: 'Bookkeeper',
    icon: 'receipt',
    color: 'green',
    grants: [
      { scope: 'project', id: vat.id, level: 'manage' },
      { scope: 'inbox', level: 'edit' },
    ],
  }
  const sam: MemberId = `user:${samId}`
  const researcher: MemberId = `agent:${research.id}`
  const books: MemberId = `agent:${bookkeeper.id}`

  // Never later than a few minutes ago, like the rest of the demo.
  const latest = ctx.now.getTime() - 5 * MINUTE
  const ago = (days: number, time: string): string => {
    const iso = zonedIso(addDays(ctx.today, -days), time, ctx.timezone)
    return Date.parse(iso) > latest ? new Date(latest).toISOString() : iso
  }

  let lastOrder = records
    .map((r) => r.data.order)
    .filter((o): o is string => typeof o === 'string')
    .sort()
    .at(-1) as string
  const nextOrder = () => {
    lastOrder = orderBetween(lastOrder, null)
    return lastOrder
  }

  const actions: DemoAction[] = []
  const act = (
    actor: MemberId,
    at: string,
    entityType: Change['entityType'],
    entityId: string,
    fields: Record<string, unknown>,
  ) => {
    actions.push({
      actor,
      at,
      change: {
        id: ulid(),
        entityType,
        entityId,
        fields,
        ts: formatTimestamp(Date.parse(at), actions.length, 'AGENT'),
        clientId: 'AGENT',
      },
    })
  }
  const add = (actor: MemberId, at: string, fields: Parameters<typeof newTask>[0]) => {
    const { id, ...rest } = newTask({ ...fields, createdAt: at, order: nextOrder() })
    act(actor, at, 'task', id, rest)
    return id
  }
  const complete = (actor: MemberId, at: string, taskId: string) =>
    act(actor, at, 'task', taskId, { status: 'completed', completedAt: at })

  // --- three days ago: Sam hands the VAT legwork to the Bookkeeper ---
  let at = ago(3, '16:00')
  act(sam, at, 'task', find('task', 'Check the mileage log').id, { assigneeId: books })
  at = ago(3, '16:01')
  act(sam, at, 'task', find('task', 'Match receipts to expenses').id, { assigneeId: books })
  at = ago(3, '17:20')
  add(books, at, {
    title: 'Collect the fuel receipts from the car',
    projectId: vat.id,
    when: { kind: 'anytime' },
    tagIds: [errands.id],
    assigneeId: sam,
  })

  // --- two days ago ---
  at = ago(2, '09:30')
  const november = records.find(
    (r) => r.entityType === 'checklistItem' && r.data.title === 'November',
  )
  if (november) act(books, at, 'checklistItem', november.id, { done: true })
  at = ago(2, '09:35')
  act(books, at, 'task', find('task', 'Submit the return online').id, {
    notes: 'Due at the end of the month. Totals are in the spreadsheet next to the receipts.',
  })
  at = ago(2, '14:00')
  act(researcher, at, 'task', find('task', 'Look into a standing desk').id, {
    notes:
      'Three options that fit the room (120 × 70 cm):\n- Basic crank desk, quiet, slow\n- Dual-motor frame with your own top\n- Compact single-motor desk\n\nThe dual-motor frame is the one reviewers keep coming back to.',
  })
  at = ago(2, '18:10')
  act(sam, at, 'task', find('task', 'Write microcopy for the empty states').id, {
    assigneeId: researcher,
  })
  at = ago(2, '18:12')
  act(sam, at, 'task', find('task', 'Homepage design').id, { assigneeId: sam })

  // --- yesterday ---
  at = ago(1, '10:00')
  add(researcher, at, {
    title: 'Read up on contrast guidance for the palette post',
    areaId: business.id,
    when: { kind: 'anytime' },
    notes: 'Collected links for the blog post on accessible colour palettes.',
    assigneeId: researcher,
  })
  at = ago(1, '11:00')
  complete(books, at, find('task', 'Check the mileage log').id)
  at = ago(1, '11:05')
  add(books, at, {
    title: 'Receipt from the print shop is missing',
    notes: 'The business cards invoice is in the bank export but there is no receipt.',
    assigneeId: sam,
  })
  at = ago(1, '15:30')
  complete(researcher, at, find('task', 'Podcast tip from Jo: "Design Details"').id)

  // --- today ---
  at = ago(0, '09:15')
  act(researcher, at, 'task', find('task', 'Write microcopy for the empty states').id, {
    notes:
      'First drafts for the four empty states are in the shared doc. Tone: short, friendly, no exclamation marks.',
  })

  return { agents: [research, bookkeeper], actions }
}
