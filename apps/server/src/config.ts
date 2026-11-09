import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface Config {
  port: number
  dataDir: string
  databasePath: string
  webDist: string
  version: string
  /** DINGEN_REGISTRATION=open laat iedereen een account maken; standaard alleen de eerste gebruiker. */
  registrationOpen: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? 'data')
  return {
    port: Number(env.PORT ?? 8080),
    dataDir,
    databasePath: path.join(dataDir, 'dingen.db'),
    webDist: path.resolve(env.WEB_DIST ?? path.join(here, '../../web/dist')),
    version: env.DINGEN_VERSION ?? '0.1.0-dev',
    registrationOpen: env.DINGEN_REGISTRATION === 'open',
  }
}
