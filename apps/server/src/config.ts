import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Wie een account mag maken: niemand behalve de eerste, iedereen, of wie een uitnodiging heeft. */
export type RegistrationMode = 'closed' | 'open' | 'invite'

export function parseRegistration(value: string | undefined): RegistrationMode {
  return value === 'open' || value === 'invite' ? value : 'closed'
}

export interface Config {
  port: number
  dataDir: string
  databasePath: string
  webDist: string
  version: string
  /** Korte commit-hash van de build (DINGEN_COMMIT), of null. */
  build: string | null
  /** DINGEN_REGISTRATION: closed (standaard, alleen de eerste gebruiker), open of invite. */
  registration: RegistrationMode
  /** DINGEN_TIMEZONE bepaalt "vandaag" voor de MCP-ingang; standaard Europe/Amsterdam. */
  timezone: string
  /**
   * DINGEN_DEMO=1: wipe all accounts and data at startup, write the demo set
   * and allow passwordless sign-in as a demo account. Development only.
   */
  demo: boolean
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
    registration: parseRegistration(env.DINGEN_REGISTRATION),
    timezone: env.DINGEN_TIMEZONE ?? 'Europe/Amsterdam',
    demo: parseFlag(env.DINGEN_DEMO),
  }
}

/** `1`, `true`, `yes` or `on` (any case) is on; everything else is off. */
export function parseFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())
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
