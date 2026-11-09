import type { Change } from '@dingen/core'
import { createMcpServer, DingenClient, type SyncTransport } from '@dingen/mcp'
import { StreamableHTTPTransport } from '@hono/mcp'
import { Hono } from 'hono'
import type { AppEnv } from '../env.js'
import type { SyncService } from '../sync.js'

/**
 * MCP over Streamable HTTP, in the server itself: Claude Code connects to
 * /mcp with an API token and gets the same tools as `dingen-mcp` over stdio.
 * Stateless: every request gets a fresh replica from the sync service.
 */
export function mcpRoutes(timezone: string) {
  const app = new Hono<AppEnv>()

  app.all('/', async (c) => {
    // Only tokens, never the session cookie: a web page must not be able to drive the MCP.
    if (!c.get('user') || c.get('authSource') !== 'token') {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const client = new DingenClient(new ServiceTransport(c.get('sync'), c.get('userId')), {
      today: () => todayIn(timezone),
    })
    const server = createMcpServer(client)
    const transport = new StreamableHTTPTransport()
    await server.connect(transport)
    const res = await transport.handleRequest(c)
    return res ?? c.body(null, 204)
  })

  return app
}

class ServiceTransport implements SyncTransport {
  constructor(
    private readonly sync: SyncService,
    private readonly userId: string,
  ) {}

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
