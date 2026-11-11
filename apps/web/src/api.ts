import { t } from './i18n/index.js'

/** Thin layer over fetch for the same-origin API (cookie session). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
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
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) code = body.error
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, code)
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? '{}' : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
}

export interface User {
  id: string
  email: string
  createdAt: string
}

export interface AuthStatus {
  hasUsers: boolean
  registrationOpen: boolean
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
])

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (AUTH_ERRORS.has(err.code))
      return t(`auth.error.${err.code}` as `auth.error.${string}` & Parameters<typeof t>[0])
    return t('app.unknownError', { code: err.code })
  }
  return t('app.noConnection')
}
