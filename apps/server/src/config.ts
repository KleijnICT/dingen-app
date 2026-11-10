import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface Config {
  port: number
  dataDir: string
  databasePath: string
  webDist: string
  version: string
  /** Korte commit-hash van de build (DINGEN_COMMIT), of null. */
  build: string | null
  /** DINGEN_REGISTRATION=open laat iedereen een account maken; standaard alleen de eerste gebruiker. */
  registrationOpen: boolean
  /** DINGEN_TIMEZONE bepaalt "vandaag" voor de MCP-ingang; standaard Europe/Amsterdam. */
  timezone: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? 'data')
  return {
    port: Number(env.PORT ?? 8080),
    dataDir,
    databasePath: path.join(dataDir, 'dingen.db'),
    webDist: path.resolve(env.WEB_DIST ?? path.join(here, '../../web/dist')),
    version: env.DINGEN_VERSION || `${packageVersion()}-dev`,
    build: env.DINGEN_COMMIT || null,
    registrationOpen: env.DINGEN_REGISTRATION === 'open',
    timezone: env.DINGEN_TIMEZONE ?? 'Europe/Amsterdam',
  }
}

/** De versie uit de root-package.json, voor builds zonder DINGEN_VERSION. */
function packageVersion(): string {
  try {
    const file = path.resolve(here, '../../../package.json')
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
}
