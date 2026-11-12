import { APP_NAME } from '@dingen/core'
import { type FormEvent, useEffect, useState } from 'react'
import { ApiError, type AuthStatus, api, type DemoAccount, errorText, type User } from './api.js'
import { useT } from './i18n/index.js'
import { inviteFromSearch, withoutInvite } from './invite.js'

interface Props {
  status: AuthStatus
  onSignedIn: (user: User) => void
}

export function AuthScreen({ status, onSignedIn }: Props) {
  const t = useT()
  // An invitation link (?invite=…) only matters once the server has users.
  const [invite] = useState(() =>
    status.hasUsers && typeof window !== 'undefined'
      ? inviteFromSearch(window.location.search)
      : null,
  )
  const [inviteState, setInviteState] = useState<'checking' | 'valid' | 'invalid' | null>(
    invite ? 'checking' : null,
  )
  // Without any users, registering is the only sensible first step; with an invitation as well.
  const [mode, setMode] = useState<'login' | 'register'>(
    !status.hasUsers || invite ? 'register' : 'login',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([])

  useEffect(() => {
    if (!status.demo) return
    let cancelled = false
    api
      .get<{ accounts: DemoAccount[] }>('/api/auth/demo')
      .then(({ accounts }) => {
        if (!cancelled) setDemoAccounts(accounts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [status.demo])

  async function signInAsDemo(account: DemoAccount) {
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.post<{ user: User }>(
        `/api/auth/demo/${encodeURIComponent(account.email)}`,
        {},
      )
      onSignedIn(user)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!invite) return
    let cancelled = false
    api
      .get(`/api/auth/invite/${encodeURIComponent(invite)}`)
      .then(() => {
        if (!cancelled) setInviteState('valid')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // A link that no longer works: say why and offer signing in instead.
        setInviteState('invalid')
        setMode('login')
        setError(err instanceof ApiError ? errorText(err) : t('auth.error.invite_invalid'))
      })
    return () => {
      cancelled = true
    }
  }, [invite, t])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body =
        mode === 'register' && invite && inviteState === 'valid'
          ? { email, password, invite }
          : { email, password }
      const { user } = await api.post<{ user: User }>(`/api/auth/${mode}`, body)
      if (invite) window.history.replaceState(null, '', withoutInvite(window.location.href))
      onSignedIn(user)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const intro =
    mode === 'register'
      ? inviteState === 'valid'
        ? t('invite.welcome')
        : status.hasUsers
          ? t('auth.createAccount')
          : t('auth.welcomeFirst')
      : t('auth.signInPrompt')
  const canRegister = status.registrationOpen || inviteState === 'valid'

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
        <button type="submit" disabled={busy || inviteState === 'checking'}>
          {mode === 'register' ? t('auth.register') : t('auth.signIn')}
        </button>
        {canRegister && status.hasUsers && (
          <button
            type="button"
            className="link"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t('auth.toRegister') : t('auth.toSignIn')}
          </button>
        )}
        {demoAccounts.length > 0 && (
          <section className="demo-accounts" aria-labelledby="demo-accounts-title">
            <h2 id="demo-accounts-title">{t('auth.demo.title')}</h2>
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                className="demo-account"
                disabled={busy}
                onClick={() => signInAsDemo(account)}
              >
                <span>{t('auth.demo.signInAs', { name: account.name })}</span>
                <span className="muted">{account.description}</span>
              </button>
            ))}
            <p className="muted small">{t('auth.demo.resets')}</p>
          </section>
        )}
      </form>
    </main>
  )
}
