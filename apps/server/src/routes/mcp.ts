import type { Change, Member } from '@dingen/core'
import { type ActivityFilter, createMcpServer, DingenClient, type SyncTransport } from '@dingen/mcp'
import { StreamableHTTPTransport } from '@hono/mcp'
import { Hono } from 'hono'
import type { ActivityKind, ActivityService } from '../activity/service.js'
import type { Access } from '../agents/access.js'
import type { AgentService } from '../agents/service.js'
import { accessOf } from '../auth/middleware.js'
import type { AppEnv } from '../env.js'
import type { SyncService } from '../sync.js'

/**
 * MCP over Streamable HTTP, in the server itself: Claude Code connects to
 * /mcp with an agent token and gets the same tools as `dingen-mcp` over stdio.
 * Stateless: every request gets a fresh replica from the sync service, with
 * only what the agent can read; its writes are checked against its grants.
 */
export function mcpRoutes(timezone: string, activity: ActivityService) {
  const app = new Hono<AppEnv>()

  app.all('/', async (c) => {
    // Only tokens, never the session cookie: a web page must not be able to drive the MCP.
    if (!c.get('user') || c.get('authSource') !== 'token') {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const transport = new ServiceTransport(
      c.get('sync'),
      c.get('agents'),
      accessOf(c),
      activity,
      c.get('user')?.createdAt ?? null,
    )
    const client = new DingenClient(transport, { today: () => todayIn(timezone), timezone })
    const server = createMcpServer(client)
    const http = new StreamableHTTPTransport()
    await server.connect(http)
    const res = await http.handleRequest(c)
    return res ?? c.body(null, 204)
  })

  return app
}

class ServiceTransport implements SyncTransport {
  constructor(
    private readonly sync: SyncService,
    private readonly agents: AgentService,
    private readonly access: Access,
    private readonly activityService: ActivityService,
    private readonly createdAt: string | null,
  ) {}

  async accountCreatedAt() {
    return this.createdAt
  }

  async activity(filter: ActivityFilter) {
    return this.activityService.list(
      this.access.userId,
      {
        kinds: filter.kinds as ActivityKind[] | undefined,
        actor: filter.actor as Access['actor'] | undefined,
        since: filter.since,
        until: filter.until,
        before: filter.before,
        limit: filter.limit,
      },
      this.access.grants,
    )
  }

  async snapshot() {
    return this.sync.snapshot(this.access.userId, this.access.grants)
  }

  async pull(since: number) {
    return this.sync.pull(this.access.userId, since, undefined, this.access.grants)
  }

  async push(changes: Change[]) {
    return this.sync.push(this.access.userId, changes, {
      access: this.access,
      members: this.agents.memberGrants(this.access.userId),
    })
  }

  async whoami() {
    return this.access.actor
  }

  async members(): Promise<Member[]> {
    return this.agents.members(this.access.userId)
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
