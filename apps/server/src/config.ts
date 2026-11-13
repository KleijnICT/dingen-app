import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTrusted } from './ingress.js'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Wie een account mag maken: niemand behalve de eerste, iedereen, of wie een uitnodiging heeft. */
export type RegistrationMode = 'closed' | 'open' | 'invite'

export function parseRegistration(value: string | undefined): RegistrationMode {
  return value === 'open' || value === 'invite' ? value : 'closed'
}

/** Home Assistant's add-on log levels (`log_level` in options.json). */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'notice', 'warning', 'error', 'fatal'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Where the Supervisor writes the add-on's options. */
export const HA_OPTIONS_PATH = '/data/options.json'

/** Home Assistant mode: the image runs as a Home Assistant app (add-on). */
export interface HomeAssistantConfig {
  /** Port of the ingress listener (DINGEN_INGRESS_PORT, default 8099). */
  ingressPort: number
  /** Addresses allowed on the ingress port (DINGEN_INGRESS_TRUSTED, default the Supervisor). */
  ingressTrusted: string[]
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
  /**
   * Home Assistant mode: on when /data/options.json exists or DINGEN_HA=1.
   * null outside Home Assistant.
   */
  homeAssistant: HomeAssistantConfig | null
  /** `log_level` from options.json (Home Assistant), else LOG_LEVEL, else `info`. */
  logLevel: LogLevel
}

export interface LoadConfigOptions {
  /** The add-on options file; default /data/options.json. */
  optionsPath?: string
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? 'data')
  const optionsPath = options.optionsPath ?? HA_OPTIONS_PATH
  const haOptions = readOptions(optionsPath)
  const ha = haOptions !== null || parseFlag(env.DINGEN_HA)
  return {
    port: Number(env.PORT ?? 8080),
    dataDir,
    databasePath: path.join(dataDir, 'dingen.db'),
    webDist: path.resolve(env.WEB_DIST ?? path.join(here, '../../web/dist')),
    version: env.DINGEN_VERSION || `${packageVersion()}-dev`,
    build: env.DINGEN_COMMIT || null,
    registration: parseRegistration(
      typeof haOptions?.registration === 'string'
        ? haOptions.registration
        : env.DINGEN_REGISTRATION,
    ),
    // The Supervisor passes the Home Assistant time zone as TZ.
    timezone: env.DINGEN_TIMEZONE || (ha && env.TZ) || 'Europe/Amsterdam',
    demo: parseFlag(env.DINGEN_DEMO),
    homeAssistant: ha
      ? {
          ingressPort: Number(env.DINGEN_INGRESS_PORT || 8099),
          ingressTrusted: parseTrusted(env.DINGEN_INGRESS_TRUSTED),
        }
      : null,
    logLevel: parseLogLevel(
      typeof haOptions?.log_level === 'string' ? haOptions.log_level : env.LOG_LEVEL,
    ),
  }
}

export function parseLogLevel(value: string | undefined): LogLevel {
  const level = (value ?? '').trim().toLowerCase()
  if (level === 'warn') return 'warning'
  return (LOG_LEVELS as readonly string[]).includes(level) ? (level as LogLevel) : 'info'
}

/** The add-on options as an object, or null when the file is absent. Unreadable → empty. */
function readOptions(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    console.warn(`Could not read ${file}; using default options.`)
    return {}
  }
}

/** `1`, `true`, `yes` or `on` (any case) is on; everything else is off. */
export function parseFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())
}

/**
 * Mutes console output below `level`: `debug` hides console.debug, `notice`
 * and up also console.log/info, `error` and up also console.warn. Errors are
 * always shown.
 */
export function applyLogLevel(
  level: LogLevel,
  target: Pick<Console, 'debug' | 'log' | 'info' | 'warn'> = console,
): void {
  const rank = LOG_LEVELS.indexOf(level)
  const mute = () => {}
  if (rank > LOG_LEVELS.indexOf('debug')) target.debug = mute
  if (rank > LOG_LEVELS.indexOf('info')) {
    target.log = mute
    target.info = mute
  }
  if (rank > LOG_LEVELS.indexOf('warning')) target.warn = mute
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
