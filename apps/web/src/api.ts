import type { ActivityItem } from '@dingen/core'
import { t } from './i18n/index.js'

/** Thin layer over fetch for the same-origin API (cookie session). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly issues: string[] = [],
  ) {
    super(code)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    let code = `http_${res.status}`
    let issues: string[] = []
    try {
      const body = (await res.json()) as { error?: string; issues?: unknown }
      if (body.error) code = body.error
      if (Array.isArray(body.issues)) issues = body.issues.filter((i) => typeof i === 'string')
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, code, issues)
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? '{}' : JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'DELETE',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
}

export interface User {
  id: string
  email: string
  createdAt: string
  /** Administrator of this server (the first account); may invite others. */
  isAdmin?: boolean
}

export type RegistrationMode = 'closed' | 'open' | 'invite'

export interface AuthStatus {
  hasUsers: boolean
  /** Can someone register without an invitation right now? */
  registrationOpen: boolean
  registration?: RegistrationMode
  /** Demo mode (DINGEN_DEMO): demo accounts can sign in without a password. */
  demo?: boolean
}

export interface DemoAccount {
  email: string
  name: string
  description: string
}

export interface ApiTokenInfo {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

const AUTH_ERRORS = new Set([
  'invalid_credentials',
  'email_taken',
  'registration_closed',
  'too_many_attempts',
  'invalid_body',
  'invite_required',
  'invite_invalid',
  'invite_expired',
  'invite_used',
  'invite_revoked',
])

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (AUTH_ERRORS.has(err.code))
      return t(`auth.error.${err.code}` as `auth.error.${string}` & Parameters<typeof t>[0])
    return t('app.unknownError', { code: err.code })
  }
  return t('app.noConnection')
}

// --- activity (Logbook, plan 19) ---

/** Filters of `GET /api/activity`; instants are ISO strings. */
export interface ActivityFilter {
  kinds?: ActivityItem['kind'][] | undefined
  actor?: string | undefined
  since?: string | undefined
  before?: number | undefined
  limit?: number | undefined
}

export interface ActivityPage {
  items: ActivityItem[]
  nextBefore: number | null
}

/** One page of Logbook lines, newest first. */
export function fetchActivity(filter: ActivityFilter): Promise<ActivityPage> {
  const params = new URLSearchParams()
  if (filter.kinds?.length) params.set('kinds', filter.kinds.join(','))
  if (filter.actor) params.set('actor', filter.actor)
  if (filter.since) params.set('since', filter.since)
  if (filter.before !== undefined) params.set('before', String(filter.before))
  if (filter.limit !== undefined) params.set('limit', String(filter.limit))
  const q = params.toString()
  return api.get<ActivityPage>(`/api/activity${q ? `?${q}` : ''}`)
}
