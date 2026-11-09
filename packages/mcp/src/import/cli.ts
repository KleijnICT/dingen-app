#!/usr/bin/env node
import fs from 'node:fs'
import { DingenClient, HttpTransport } from '../client.js'
import { todayIn } from '../time.js'
import { describePlan, importTickTick, parseTickTickCsv, planTickTickImport } from './ticktick.js'

/**
 * dingen-import ticktick <backup.csv> [--apply] [--url URL] [--token TOKEN]
 *   [--closed "List A,List B"] [--tag-parents parents.json] [--timezone Europe/Amsterdam]
 * Without --apply it only prints what would happen.
 */
const args = process.argv.slice(2)
const [command, file] = args
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
if (command !== 'ticktick' || !file) {
  console.error(
    'Usage: dingen-import ticktick <backup.csv> [--apply] [--url URL] [--token TOKEN] [--closed "A,B"] [--tag-parents file.json] [--timezone TZ]',
  )
  process.exit(2)
}
const timezone = flag('timezone') ?? process.env.DINGEN_TIMEZONE ?? 'Europe/Amsterdam'
const tagParentsFile = flag('tag-parents')
const tagParents = tagParentsFile
  ? (JSON.parse(fs.readFileSync(tagParentsFile, 'utf8')) as Record<string, string>)
  : undefined
const closedLists = flag('closed')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const rows = parseTickTickCsv(fs.readFileSync(file, 'utf8'))
const plan = planTickTickImport(rows, {
  today: todayIn(timezone),
  timezone,
  ...(tagParents ? { tagParents } : {}),
  ...(closedLists ? { closedLists } : {}),
})
console.log(describePlan(plan))

if (!args.includes('--apply')) {
  console.log('\nDry run. Add --apply to write this to Dingen.')
  process.exit(0)
}
const url = flag('url') ?? process.env.DINGEN_URL
const token = flag('token') ?? process.env.DINGEN_TOKEN
if (!url || !token) {
  console.error('Need --url and --token (or DINGEN_URL and DINGEN_TOKEN) to apply.')
  process.exit(2)
}
const client = new DingenClient(new HttpTransport(url, token), { today: () => todayIn(timezone) })
await client.refresh()
const result = importTickTick(client, plan)
await client.flush()
console.log(`\nWritten: ${JSON.stringify(result.created)}; already present: ${result.alreadyThere}`)
