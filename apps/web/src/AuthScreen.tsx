import { APP_NAME } from '@dingen/core'
import { type FormEvent, useState } from 'react'
import { type AuthStatus, api, errorText, type User } from './api.js'
import { useT } from './i18n/index.js'

interface Props {
  status: AuthStatus
  onSignedIn: (user: User) => void
}

export function AuthScreen({ status, onSignedIn }: Props) {
  const t = useT()
  // Without any users, registering is the only sensible first step.
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

  const intro =
    mode === 'register'
      ? status.hasUsers
        ? t('auth.createAccount')
        : t('auth.welcomeFirst')
      : t('auth.signInPrompt')

  return (
    <main className="shell">
      <form className="card" onSubmit={submit}>
        <h1>{APP_NAME}</h1>
        <p className="muted">{intro}</p>
        <label>
          {t('auth.email')}
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            // biome-ignore lint/a11y/noAutofocus: a sign-in form has exactly one sensible starting point
            autoFocus
          />
        </label>
        <label>
          {t('auth.password')}
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
          {mode === 'register' ? t('auth.register') : t('auth.signIn')}
        </button>
        {status.registrationOpen && status.hasUsers && (
          <button
            type="button"
            className="link"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t('auth.toRegister') : t('auth.toSignIn')}
          </button>
        )}
      </form>
    </main>
  )
}
