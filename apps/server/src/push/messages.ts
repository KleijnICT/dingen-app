/**
 * The texts the server puts in push notifications, per language. The language
 * is the one the web app used on the device when it subscribed (plan 31); a
 * subscription without one gets English, the app's default. The wording
 * follows the web app's own texts (apps/web/src/i18n).
 */

export const PUSH_LOCALES = ['en', 'nl'] as const
export type PushLocale = (typeof PUSH_LOCALES)[number]
export const DEFAULT_PUSH_LOCALE: PushLocale = 'en'

interface PushMessages {
  /** Title of the notification when an agent assigns a task; `who` is the agent's name. */
  assigned: (who: string) => string
  /** Stands in for the agent's name when it has none. */
  anAgent: string
  /** Stands in for a task without a title. */
  untitled: string
}

const messages: Record<PushLocale, PushMessages> = {
  en: {
    assigned: (who) => `${who} assigned you a task`,
    anAgent: 'An agent',
    untitled: 'Untitled',
  },
  nl: {
    assigned: (who) => `${who} heeft je een taak toegewezen`,
    anAgent: 'Een agent',
    untitled: 'Zonder titel',
  },
}

/** A known locale, or null for anything else (missing, unknown, not a string). */
export function parsePushLocale(value: unknown): PushLocale | null {
  return typeof value === 'string' && (PUSH_LOCALES as readonly string[]).includes(value)
    ? (value as PushLocale)
    : null
}

/** The texts for a subscription's language; unknown or none gives English. */
export function pushMessages(locale: string | null | undefined): PushMessages {
  return messages[parsePushLocale(locale) ?? DEFAULT_PUSH_LOCALE]
}
