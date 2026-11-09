import { useSyncExternalStore } from 'react'
import { en, type MessageKey, type Messages } from './en.js'
import { nl } from './nl.js'

/**
 * A small, typed translation layer. English is the source of truth and the
 * default; a language is a complete table of the same keys. The person can pick
 * another language on the Account page (stored per device).
 */

export const LOCALES = {
  en: { messages: en, name: 'English' },
  nl: { messages: nl, name: 'Nederlands' },
} as const

export type Locale = keyof typeof LOCALES

export const DEFAULT_LOCALE: Locale = 'en'
const STORAGE_KEY = 'dingen.locale'
const listeners = new Set<() => void>()

function readLocale(): Locale {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    return stored && stored in LOCALES ? (stored as Locale) : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

let locale: Locale = readLocale()

export function getLocale(): Locale {
  return locale
}

export function setLocale(next: Locale): void {
  locale = next
  try {
    if (next === DEFAULT_LOCALE) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // storage unavailable; the choice still applies for this page
  }
  applyDocumentLang()
  for (const l of listeners) l()
}

function applyDocumentLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}
applyDocumentLang()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Re-renders when the locale changes and returns the current one. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const messages: Messages = LOCALES[locale].messages
  let text: string = messages[key] ?? en[key]
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** `t` bound to the current locale; use inside components so they re-render on change. */
export function useT(): typeof t {
  useLocale()
  return t
}

const BCP47: Record<Locale, string> = { en: 'en-GB', nl: 'nl-NL' }

export function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(BCP47[locale], options).format(date)
}
export type { MessageKey, Messages } from './en.js'
