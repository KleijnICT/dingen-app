#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DingenClient, HttpTransport } from './client.js'
import { createMcpServer } from './server.js'
import { todayIn } from './time.js'

/** `dingen-mcp`: MCP over stdio for Claude Code and Claude Desktop. */
const url = process.env.DINGEN_URL
const token = process.env.DINGEN_TOKEN
if (!url || !token) {
  console.error('Set DINGEN_URL (for example https://dingen.example.com) and DINGEN_TOKEN.')
  process.exit(2)
}
const timezone = process.env.DINGEN_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone
const client = new DingenClient(new HttpTransport(url, token), { today: () => todayIn(timezone) })
const server = createMcpServer(client)
await server.connect(new StdioServerTransport())
