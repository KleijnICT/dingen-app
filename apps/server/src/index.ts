import { serve } from '@hono/node-server'
import { applyLogLevel, loadConfig } from './config.js'
import type { AppBindings } from './env.js'
import { DataDirLock } from './lock.js'
import { ServerRuntime } from './runtime.js'
import { StartupError } from './startup.js'

const config = loadConfig()
applyLogLevel(config.logLevel)
if (config.homeAssistant) {
  console.log(
    `Home Assistant mode: ingress on port ${config.homeAssistant.ingressPort} (trusted: ${config.homeAssistant.ingressTrusted.join(', ')}), registration ${config.registration}, time zone ${config.timezone}`,
  )
}

// One server per data directory; `dingen restore` takes the same lock, so it
// refuses while the server runs (see lock.ts).
let lock: DataDirLock | null = null
try {
  lock = DataDirLock.acquire(config.dataDir)
  if (lock === null) {
    console.error(`Another Dingen server or a restore is using ${config.dataDir}; not starting.`)
    process.exit(1)
  }
} catch (err) {
  console.warn(
    `Could not lock ${config.dataDir} (${err instanceof Error ? err.message : String(err)}); starting without the lock, so \`dingen restore\` cannot tell that the server runs.`,
  )
}
// Held for the life of the process; the system releases it on exit.
process.on('exit', () => lock?.release())

// A backup before SQL or data migrations; if a migration fails, that backup
// comes back and the server stops (see startup.ts). The runtime holds the
// database, the app and the timers, and can swap them for a restore from
// Administration (see runtime.ts).
let runtime: ServerRuntime
try {
  runtime = await ServerRuntime.start(config)
} catch (err) {
  if (!(err instanceof StartupError)) throw err
  for (const line of err.message.split('\n')) console.error(line)
  process.exit(1)
}

serve(
  { fetch: (req, env) => runtime.fetch(req, env as AppBindings), port: config.port },
  (info) => {
    console.log(
      `Dingen ${config.version}${config.build ? ` (${config.build})` : ''} listening on http://localhost:${info.port}`,
    )
    console.log(`Database: ${config.databasePath}`)
  },
)

if (config.homeAssistant) {
  // Home Assistant ingress: the same app, but the listener marks its requests,
  // so ingressGate only lets the Supervisor in and signs in the HA user.
  serve(
    {
      fetch: (req, env) => runtime.fetch(req, { ...(env as object), ingress: true }),
      port: config.homeAssistant.ingressPort,
    },
    (info) => console.log(`Home Assistant ingress listening on port ${info.port}`),
  )
}
