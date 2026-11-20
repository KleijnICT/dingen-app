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
  /** `DATA_DIR/backups`. */
  backupDir: string
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
  /**
   * DINGEN_BACKUPS: nightly back-ups in `DATA_DIR/backups`, on unless `off`
   * (or `0`, `false`, `no`). Back-ups before an update are always made.
   */
  backups: boolean
  /** Outgoing mail (SMTP_*), or null when SMTP_HOST or SMTP_FROM is missing. */
  mail: MailConfig | null
  /**
   * DINGEN_PUBLIC_URL: the address people open Dingen on (e.g.
   * `https://dingen.example.com`), used for links in mail. Null: the request's own address.
   */
  publicUrl: string | null
}

/** SMTP settings for outgoing mail (password resets, the test mail). */
export interface MailConfig {
  host: string
  port: number
  /** TLS from the start (port 465). Off: STARTTLS when the server offers it. */
  secure: boolean
  user: string | null
  /** Never logged and never sent to a client. */
  password: string | null
  /** The sender, e.g. `Dingen <dingen@example.com>`. */
  from: string
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
    backupDir: path.join(dataDir, 'backups'),
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
    backups: !['off', '0', 'false', 'no'].includes((env.DINGEN_BACKUPS ?? '').trim().toLowerCase()),
    mail: parseMail(env, haOptions),
    publicUrl: parsePublicUrl(
      typeof haOptions?.public_url === 'string' ? haOptions.public_url : env.DINGEN_PUBLIC_URL,
    ),
  }
}

/**
 * The SMTP settings from SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
 * SMTP_FROM and SMTP_SECURE; in Home Assistant the app's options `smtp_host`,
 * `smtp_port`, … go first. Mail is configured when there is a host and a
 * sender. The port defaults to 465 with SMTP_SECURE, else 587; SMTP_SECURE
 * defaults to on for port 465.
 */
export function parseMail(
  env: NodeJS.ProcessEnv,
  haOptions: Record<string, unknown> | null = null,
): MailConfig | null {
  const pick = (option: string, variable: string): string => {
    const value = haOptions?.[option]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return (env[variable] ?? '').trim()
  }
  const host = pick('smtp_host', 'SMTP_HOST')
  const from = pick('smtp_from', 'SMTP_FROM')
  if (!host || !from) return null
  const portText = pick('smtp_port', 'SMTP_PORT')
  const secureText = pick('smtp_secure', 'SMTP_SECURE')
  const parsedPort = Number(portText)
  const validPort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536
  const secure = secureText ? parseFlag(secureText) : validPort && parsedPort === 465
  const user = pick('smtp_user', 'SMTP_USER')
  // A password keeps its spaces: only an empty one counts as none.
  const rawPassword = haOptions?.smtp_password
  const password =
    typeof rawPassword === 'string' && rawPassword !== '' ? rawPassword : env.SMTP_PASSWORD || ''
  return {
    host,
    port: validPort ? parsedPort : secure ? 465 : 587,
    secure,
    user: user || null,
    password: password || null,
    from,
  }
}

/** An http(s) origin plus optional path, without a trailing slash; anything else is null. */
export function parsePublicUrl(value: string | undefined): string | null {
  const text = (value ?? '').trim()
  if (!text) return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
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
