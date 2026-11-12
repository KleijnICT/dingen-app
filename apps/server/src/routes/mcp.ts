import type { AgentGrant, Change, Member } from '@dingen/core'
import { type ActivityFilter, createMcpServer, DingenClient, type SyncTransport } from '@dingen/mcp'
import { StreamableHTTPTransport } from '@hono/mcp'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { requestAccess } from '../activity/access.js'
import type { ActivityKind, ActivityService } from '../activity/service.js'
import type { Db } from '../db.js'
import type { AppEnv } from '../env.js'
import { agents, users } from '../schema.js'
import type { SyncService } from '../sync.js'

/**
 * MCP over Streamable HTTP, in the server itself: Claude Code connects to
 * /mcp with an API token and gets the same tools as `dingen-mcp` over stdio.
 * Stateless: every request gets a fresh replica from the sync service.
 */
export function mcpRoutes(timezone: string, db: Db, activity: ActivityService) {
  const app = new Hono<AppEnv>()

  app.all('/', async (c) => {
    // Only tokens, never the session cookie: a web page must not be able to drive the MCP.
    if (!c.get('user') || c.get('authSource') !== 'token') {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const serviceTransport = new ServiceTransport(c.get('sync'), c.get('userId'), {
      db,
      activity,
      grants: requestAccess(c, db).grants,
    })
    const client = new DingenClient(serviceTransport, {
      today: () => todayIn(timezone),
      timezone,
    })
    const server = createMcpServer(client)
    const transport = new StreamableHTTPTransport()
    await server.connect(transport)
    const res = await transport.handleRequest(c)
    return res ?? c.body(null, 204)
  })

  return app
}

interface ActivityAccess {
  db: Db
  activity: ActivityService
  /** The agent's grants; null for the owner. */
  grants: AgentGrant[] | null
}

class ServiceTransport implements SyncTransport {
  constructor(
    private readonly sync: SyncService,
    private readonly userId: string,
    private readonly access: ActivityAccess,
  ) {}

  async activity(filter: ActivityFilter) {
    return this.access.activity.list(
      this.userId,
      {
        kinds: filter.kinds as ActivityKind[] | undefined,
        actor: filter.actor as `user:${string}` | `agent:${string}` | undefined,
        since: filter.since,
        until: filter.until,
        before: filter.before,
        limit: filter.limit,
      },
      this.access.grants,
    )
  }

  /** The owner and every agent, revoked ones too: their past actions keep a name. */
  async members(): Promise<Member[]> {
    const { db } = this.access
    const owner = db.select().from(users).where(eq(users.id, this.userId)).get()
    const own = db.select().from(agents).where(eq(agents.userId, this.userId)).all()
    return [
      ...(owner
        ? [
            {
              id: `user:${owner.id}`,
              kind: 'user',
              name: owner.email,
              icon: null,
              color: null,
            } as Member,
          ]
        : []),
      ...own.map(
        (a): Member => ({
          id: `agent:${a.id}`,
          kind: 'agent',
          name: a.name,
          icon: a.icon,
          color: a.color,
        }),
      ),
    ]
  }

  async snapshot() {
    return this.sync.snapshot(this.userId)
  }

  async pull(since: number) {
    return this.sync.pull(this.userId, since)
  }

  async push(changes: Change[]) {
    return this.sync.push(this.userId, changes)
  }
}

function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
