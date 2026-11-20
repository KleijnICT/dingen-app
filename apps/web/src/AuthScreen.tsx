import { APP_NAME } from '@dingen/core'
import { type FormEvent, useEffect, useState } from 'react'
import {
  ApiError,
  type AuthStatus,
  api,
  type DemoAccount,
  errorText,
  type LoginResult,
  type User,
} from './api.js'
import { getLocale, useT } from './i18n/index.js'
import { inviteFromSearch, withoutInvite } from './invite.js'
import { resetFromSearch, withoutReset } from './reset.js'

interface Props {
  status: AuthStatus
  onSignedIn: (user: User) => void
}

/**
 * Sign in, register, "Forgot password?", the two-step code after the
 * password, and "Choose a new password" from a reset link (`?reset=…`).
 */
type Mode = 'login' | 'register' | 'forgot' | 'twoStep' | 'reset'

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
  // A reset link (?reset=…) opens "Choose a new password".
  const [reset] = useState(() =>
    typeof window !== 'undefined' ? resetFromSearch(window.location.search) : null,
  )
  const [resetState, setResetState] = useState<'checking' | 'valid' | 'invalid' | null>(
    reset ? 'checking' : null,
  )
  // Without any users, registering is the only sensible first step; with an invitation as well.
  const [mode, setMode] = useState<Mode>(
    reset ? 'reset' : !status.hasUsers || invite ? 'register' : 'login',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Two-step verification: the challenge from the password step, and the code.
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
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

  useEffect(() => {
    if (!reset) return
    let cancelled = false
    api
      .get(`/api/auth/reset/${encodeURIComponent(reset)}`)
      .then(() => {
        if (!cancelled) setResetState('valid')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // A link that no longer works: say why; "Back to sign in" stays.
        setResetState('invalid')
        setError(errorText(err))
      })
    return () => {
      cancelled = true
    }
  }, [reset])

  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
    setCode('')
    setUseRecovery(false)
    if (next !== 'twoStep') setChallenge(null)
  }

  /** Leaves the reset screen; the link comes out of the address bar. */
  function leaveReset(message: string | null) {
    window.history.replaceState(null, '', withoutReset(window.location.href))
    setResetState(null)
    setPassword('')
    switchTo('login')
    setNotice(message)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'forgot') {
        await api.post('/api/auth/forgot', { email, language: getLocale() })
        setNotice(t('auth.forgot.sent', { email }))
        return
      }
      if (mode === 'reset') {
        await api.post('/api/auth/reset', { token: reset, password })
        leaveReset(t('auth.reset.done'))
        return
      }
      if (mode === 'twoStep') {
        const { user } = await api.post<{ user: User }>('/api/auth/login/two-step', {
          challenge,
          code,
        })
        onSignedIn(user)
        return
      }
      const body =
        mode === 'register' && invite && inviteState === 'valid'
          ? { email, password, invite }
          : { email, password }
      const result = await api.post<LoginResult>(`/api/auth/${mode}`, body)
      if ('twoStep' in result) {
        switchTo('twoStep')
        setChallenge(result.challenge)
        return
      }
      if (invite) window.history.replaceState(null, '', withoutInvite(window.location.href))
      onSignedIn(result.user)
    } catch (err) {
      // Too slow or too many wrong codes: start over with the password.
      if (mode === 'twoStep' && err instanceof ApiError && err.status !== 401) switchTo('login')
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const intro =
    mode === 'reset'
      ? t('auth.reset.prompt')
      : mode === 'forgot'
        ? t('auth.forgot.intro')
        : mode === 'twoStep'
          ? useRecovery
            ? t('auth.twoStep.recoveryPrompt')
            : t('auth.twoStep.prompt')
          : mode === 'register'
            ? inviteState === 'valid'
              ? t('invite.welcome')
              : status.hasUsers
                ? t('auth.createAccount')
                : t('auth.welcomeFirst')
            : t('auth.signInPrompt')
  const canRegister = status.registrationOpen || inviteState === 'valid'
  const forgotSent = mode === 'forgot' && notice !== null
  const submitLabel =
    mode === 'register'
      ? t('auth.register')
      : mode === 'forgot'
        ? t('auth.forgot.send')
        : mode === 'reset'
          ? t('account.password.save')
          : mode === 'twoStep'
            ? t('auth.twoStep.verify')
            : t('auth.signIn')
  const showEmail = mode === 'login' || mode === 'register' || (mode === 'forgot' && !forgotSent)
  const showPassword =
    mode === 'login' || mode === 'register' || (mode === 'reset' && resetState !== 'invalid')

  return (
    <main className="shell">
      <form className="card" onSubmit={submit}>
        <h1>{APP_NAME}</h1>
        <p className="muted">{intro}</p>
        {showEmail && (
          <label>
            {t('auth.email')}
            <input
              // A new field per screen, so it takes the focus when the screen changes.
              key={mode === 'forgot' ? 'forgot' : 'sign-in'}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              // biome-ignore lint/a11y/noAutofocus: a sign-in form has exactly one sensible starting point
              autoFocus
            />
          </label>
        )}
        {showPassword && (
          <label>
            {mode === 'reset' ? t('account.password.new') : t('auth.password')}
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              // biome-ignore lint/a11y/noAutofocus: the only field on the reset screen
              autoFocus={mode === 'reset'}
            />
          </label>
        )}
        {mode === 'twoStep' && (
          <label>
            {useRecovery ? t('auth.twoStep.recoveryCode') : t('auth.twoStep.code')}
            <input
              key={useRecovery ? 'recovery' : 'totp'}
              className="code-input"
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              maxLength={useRecovery ? 12 : 7}
              spellCheck={false}
              autoCapitalize="none"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              // biome-ignore lint/a11y/noAutofocus: the only field on this screen
              autoFocus
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        {notice && (
          <p className="muted" role="status">
            {notice}
          </p>
        )}
        {!forgotSent && resetState !== 'invalid' && (
          <button
            type="submit"
            className="button-primary"
            disabled={busy || inviteState === 'checking' || resetState === 'checking'}
          >
            {submitLabel}
          </button>
        )}
        {mode === 'login' && status.passwordReset && (
          <button type="button" className="link" onClick={() => switchTo('forgot')}>
            {t('auth.forgot')}
          </button>
        )}
        {mode === 'twoStep' && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setUseRecovery(!useRecovery)
              setCode('')
              setError(null)
            }}
          >
            {useRecovery ? t('auth.twoStep.useApp') : t('auth.twoStep.useRecovery')}
          </button>
        )}
        {(mode === 'forgot' || mode === 'twoStep') && (
          <button type="button" className="link" onClick={() => switchTo('login')}>
            {t('auth.backToSignIn')}
          </button>
        )}
        {mode === 'reset' && (
          <button type="button" className="link" onClick={() => leaveReset(null)}>
            {t('auth.backToSignIn')}
          </button>
        )}
        {(mode === 'login' || mode === 'register') && canRegister && status.hasUsers && (
          <button
            type="button"
            className="link"
            onClick={() => switchTo(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t('auth.toRegister') : t('auth.toSignIn')}
          </button>
        )}
        {demoAccounts.length > 0 && mode === 'login' && (
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
