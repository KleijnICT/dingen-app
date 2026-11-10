#!/usr/bin/env node
import fs from 'node:fs'
import { DingenClient, HttpTransport } from '../client.js'
import { todayIn } from '../time.js'
import {
  describePlan,
  type ImportOptions,
  importTickTick,
  parseTickTickCsv,
  planTickTickImport,
} from './ticktick.js'
import { convertTickTickDump, parseTickTickDump } from './ticktick-api.js'

/**
 * dingen-import ticktick <backup.csv> [--apply] [--url URL] [--token TOKEN | --token-file PATH]
 *   [--closed "List A,List B"] [--tag-parents parents.json] [--timezone Europe/Amsterdam]
 * dingen-import ticktick-api <dump.json> [--apply] [--url URL] [--token TOKEN | --token-file PATH]
 *   [--timezone Europe/Amsterdam]
 * Without --apply it only prints what would happen.
 */
const USAGE = `Usage:
  dingen-import ticktick <backup.csv> [--apply] [--url URL] [--token TOKEN | --token-file PATH] [--closed "A,B"] [--tag-parents file.json] [--timezone TZ]
  dingen-import ticktick-api <dump.json> [--apply] [--url URL] [--token TOKEN | --token-file PATH] [--timezone TZ]`
const args = process.argv.slice(2)
const [command, file] = args
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
if ((command !== 'ticktick' && command !== 'ticktick-api') || !file) {
  console.error(USAGE)
  process.exit(2)
}
const timezone = flag('timezone') ?? process.env.DINGEN_TIMEZONE ?? 'Europe/Amsterdam'
const base = { today: todayIn(timezone), timezone }

let plan: ReturnType<typeof planTickTickImport>
if (command === 'ticktick-api') {
  const { rows, options } = convertTickTickDump(parseTickTickDump(fs.readFileSync(file, 'utf8')))
  plan = planTickTickImport(rows, { ...base, ...options })
} else {
  const tagParentsFile = flag('tag-parents')
  const tagParents = tagParentsFile
    ? (JSON.parse(fs.readFileSync(tagParentsFile, 'utf8')) as Record<string, string>)
    : undefined
  const closedLists = flag('closed')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const options: ImportOptions = {
    ...base,
    ...(tagParents ? { tagParents } : {}),
    ...(closedLists ? { closedLists } : {}),
  }
  plan = planTickTickImport(parseTickTickCsv(fs.readFileSync(file, 'utf8')), options)
}
console.log(describePlan(plan))

if (!args.includes('--apply')) {
  console.log('\nDry run. Add --apply to write this to Dingen.')
  process.exit(0)
}
const url = flag('url') ?? process.env.DINGEN_URL
const tokenFile = flag('token-file')
const token =
  flag('token') ??
  (tokenFile ? fs.readFileSync(tokenFile, 'utf8').trim() : undefined) ??
  process.env.DINGEN_TOKEN
if (!url || !token) {
  console.error('Need --url and --token or --token-file (or DINGEN_URL and DINGEN_TOKEN) to apply.')
  process.exit(2)
}
const client = new DingenClient(new HttpTransport(url, token), { today: () => todayIn(timezone) })
await client.refresh()
const result = importTickTick(client, plan)
await client.flush()
console.log(`\nWritten: ${JSON.stringify(result.created)}; already present: ${result.alreadyThere}`)
