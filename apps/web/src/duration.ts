import { fitsDuration, formatDuration, MAX_DURATION, type Task } from '@dingen/core'
import { useSyncExternalStore } from 'react'
import { getLocale, useLocale } from './i18n/index.js'

/**
 * Estimated duration in the web app (plan 25): the text of a duration in the
 * current language, reading a typed-in value, and the duration filter of Today
 * and Anytime, remembered per device and per list.
 */

/** `15m`, `1u30` in Dutch, `1h30` in English. */
export function durationText(minutes: number, locale = getLocale()): string {
  return formatDuration(minutes, locale === 'nl' ? 'u' : 'h')
}

/** `durationText` that re-renders when the language changes. */
export function useDurationText(): (minutes: number) => string {
  const locale = useLocale()
  return (minutes) => durationText(minutes, locale)
}

/**
 * A typed-in duration in minutes, or null when it is not one. Plain numbers are
 * minutes; `1u30`, `1h30`, `2u`, `1:30`, `45m` and `1,5u` are read too.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '').replace(',', '.')
  if (!text) return null
  const plain = text.match(/^(\d+)(m|min)?$/)
  const clock = text.match(/^(\d+):(\d{1,2})$/)
  const hours = text.match(/^(\d+(?:\.\d+)?)[uh](?:(\d{1,2})m?)?$/)
  const minutes = plain
    ? Number(plain[1])
    : clock
      ? Number(clock[1]) * 60 + Number(clock[2])
      : hours
        ? Number(hours[1]) * 60 + (hours[2] ? Number(hours[2]) : 0)
        : Number.NaN
  const rounded = Math.round(minutes)
  return rounded >= 1 && rounded <= MAX_DURATION ? rounded : null
}

/**
 * The tasks that fit in the filter's maximum; all of them without a filter.
 * Tasks in `keep` stay regardless: one just added here has no duration yet.
 */
export function filterByDuration<T extends Pick<Task, 'id' | 'duration'>>(
  tasks: T[],
  max: number | null,
  keep: readonly string[] = [],
): T[] {
  if (max === null) return tasks
  return tasks.filter((task) => fitsDuration(task, max) || keep.includes(task.id))
}

/** The lists with a duration filter. */
export type DurationFilterList = 'today' | 'anytime'

export function hasDurationFilter(list: string): list is DurationFilterList {
  return list === 'today' || list === 'anytime'
}

/** The stored filters, `today:15,anytime:30`: the maximum of one list. */
export function readDurationFilter(raw: string, list: DurationFilterList): number | null {
  for (const entry of raw.split(',')) {
    const [name, value] = entry.split(':')
    if (name !== list) continue
    const max = Number(value)
    return Number.isInteger(max) && max > 0 ? max : null
  }
  return null
}

/** The stored filters with the maximum of one list set, or taken out for null. */
export function writeDurationFilter(
  raw: string,
  list: DurationFilterList,
  max: number | null,
): string {
  const others = raw.split(',').filter((entry) => entry && !entry.startsWith(`${list}:`))
  return (max === null ? others : [...others, `${list}:${max}`]).join(',')
}

const KEY = 'dingen.durationFilter'
const listeners = new Set<() => void>()

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setDurationFilter(list: DurationFilterList, max: number | null): void {
  const next = writeDurationFilter(readRaw(), list, max)
  try {
    if (next) localStorage.setItem(KEY, next)
    else localStorage.removeItem(KEY)
  } catch {
    // Private windows may refuse storage; the choice then lasts until reload.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The duration filter of a list on this device; null when it is off or the list has none. */
export function useDurationFilter(list: string): number | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => '')
  return hasDurationFilter(list) ? readDurationFilter(raw, list) : null
}
