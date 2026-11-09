import { APP_NAME } from '@dingen/core'
import { type FormEvent, useState } from 'react'
import { type AuthStatus, api, errorText, type User } from './api.js'

interface Props {
  status: AuthStatus
  onSignedIn: (user: User) => void
}

export function AuthScreen({ status, onSignedIn }: Props) {
  // Zonder gebruikers is registreren de enige zinnige eerste stap.
  const [mode, setMode] = useState<'login' | 'register'>(status.hasUsers ? 'login' : 'register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.post<{ user: User }>(`/api/auth/${mode}`, { email, password })
      onSignedIn(user)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const canRegister = status.registrationOpen

  return (
    <main className="shell">
      <form className="card" onSubmit={submit}>
        <h1>{APP_NAME}</h1>
        <p className="muted">
          {mode === 'register'
            ? status.hasUsers
              ? 'Maak een account aan.'
              : 'Welkom. Maak het eerste account aan op deze server.'
            : 'Log in om verder te gaan.'}
        </p>
        <label>
          E-mailadres
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            // biome-ignore lint/a11y/noAutofocus: een inlogscherm heeft maar één zinnig startpunt
            autoFocus
          />
        </label>
        <label>
          Wachtwoord
          <input
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'register' ? 'Account aanmaken' : 'Inloggen'}
        </button>
        {canRegister && status.hasUsers && (
          <button
            type="button"
            className="link"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Nog geen account? Registreren' : 'Al een account? Inloggen'}
          </button>
        )}
      </form>
    </main>
  )
}
