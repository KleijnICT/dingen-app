import { randomBytes } from 'node:crypto'
import { ulid } from '@dingen/core'
import { AgentService } from '../agents/service.js'
import { hashPassword } from '../auth/password.js'
import type { Db } from '../db.js'
import {
  agentGrants,
  agents,
  apiTokens,
  calendars,
  changes,
  entities,
  invitations,
  pushSubscriptions,
  reminderDeliveries,
  sessions,
  users,
} from '../schema.js'
import { SyncService } from '../sync.js'
import { DEMO_ACCOUNTS } from './accounts.js'
import { samAgents } from './agents.js'
import { buildDemoSet } from './dataset.js'
import { todayIn } from './time.js'

export interface DemoSeedOptions {
  timezone: string
  now?: Date
}

export interface DemoSeedResult {
  users: { email: string; id: string; entities: number }[]
}

/**
 * Wipes every account and everything that belongs to one, then writes the demo
 * accounts and their data. Installation metadata (the `meta` table, such as
 * the push keys) stays. Only for DINGEN_DEMO.
 */
export async function resetToDemo(db: Db, options: DemoSeedOptions): Promise<DemoSeedResult> {
  const now = options.now ?? new Date()
  const set = buildDemoSet({
    now,
    timezone: options.timezone,
    today: todayIn(options.timezone, now),
  })
  // Nobody signs in with a password in demo mode: a random one nobody knows.
  const hashes = await Promise.all(
    DEMO_ACCOUNTS.map(() => hashPassword(randomBytes(32).toString('base64url'))),
  )

  const created = db.transaction((tx) => {
    tx.delete(reminderDeliveries).run()
    tx.delete(pushSubscriptions).run()
    tx.delete(calendars).run()
    tx.delete(apiTokens).run()
    tx.delete(agentGrants).run()
    tx.delete(agents).run()
    tx.delete(sessions).run()
    tx.delete(invitations).run()
    tx.delete(entities).run()
    tx.delete(changes).run()
    tx.delete(users).run()

    return DEMO_ACCOUNTS.map((account, i) => {
      const id = ulid()
      tx.insert(users)
        .values({
          id,
          email: account.email,
          passwordHash: hashes[i] as string,
          createdAt: new Date(now.getTime() - 90 * 86_400_000).toISOString(),
          isAdmin: i === 0,
        })
        .run()
      return { email: account.email, id }
    })
  })

  // The same path as an import, so the change log and the entities agree.
  const sync = new SyncService(db)
  const result = {
    users: created.map((u) => {
      const records = set[u.email] ?? []
      if (records.length > 0) sync.importRecords(u.id, records)
      return { ...u, entities: records.length }
    }),
  }

  // Sam's agents and their recent work, through the normal push with each actor's grants.
  const sam = created.find((u) => u.email === 'sam@example.com')
  if (sam) {
    const ctx = { now, timezone: options.timezone, today: todayIn(options.timezone, now) }
    const story = samAgents(ctx, sam.id, set[sam.email] ?? [])
    db.transaction((tx) => {
      for (const [i, a] of story.agents.entries()) {
        tx.insert(agents)
          .values({
            id: a.id,
            userId: sam.id,
            name: a.name,
            icon: a.icon,
            color: a.color,
            // Made a week ago, one minute apart so the list keeps this order.
            createdAt: new Date(now.getTime() - 7 * 86_400_000 + i * 60_000).toISOString(),
          })
          .run()
        tx.insert(agentGrants)
          .values(
            a.grants.map((g) => ({
              agentId: a.id,
              scope: g.scope,
              scopeId: g.scope === 'area' || g.scope === 'project' ? g.id : '',
              level: g.level,
            })),
          )
          .run()
      }
    })
    const members = new AgentService(db).memberGrants(sam.id)
    for (const action of story.actions) {
      const grants = members(action.actor)
      if (grants === undefined) throw new Error(`Unknown demo actor ${action.actor}`)
      sync.push(sam.id, [action.change], {
        access: { userId: sam.id, actor: action.actor, grants },
        members,
        receivedAt: action.at,
      })
    }
  }
  return result
}
