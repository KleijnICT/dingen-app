/** Dunne laag over fetch voor de API van dezelfde oorsprong (cookie-sessie). */

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
      // geen JSON-body
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

export const ERROR_TEXT: Record<string, string> = {
  invalid_credentials: 'E-mailadres of wachtwoord klopt niet.',
  email_taken: 'Er bestaat al een account met dit e-mailadres.',
  registration_closed: 'Registratie is gesloten op deze server.',
  too_many_attempts: 'Te veel pogingen. Probeer het over een kwartier opnieuw.',
  invalid_body: 'Controleer het e-mailadres en een wachtwoord van minstens 8 tekens.',
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return ERROR_TEXT[err.code] ?? `Er ging iets mis (${err.code}).`
  return 'Geen verbinding met de server.'
}
