import { useCallback, useEffect, useState } from 'react'
import { Account } from './Account.js'
import { AuthScreen } from './AuthScreen.js'
import { type AuthStatus, api, errorText, type User } from './api.js'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'anonymous'; status: AuthStatus }
  | { kind: 'signedIn'; user: User }

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const bootstrap = useCallback(async () => {
    try {
      const status = await api.get<AuthStatus>('/api/auth/status')
      try {
        const { user } = await api.get<{ user: User }>('/api/auth/me')
        setState({ kind: 'signedIn', user })
      } catch {
        setState({ kind: 'anonymous', status })
      }
    } catch (err) {
      setState({ kind: 'error', message: errorText(err) })
    }
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  switch (state.kind) {
    case 'loading':
      return (
        <main className="shell">
          <p className="muted">Laden…</p>
        </main>
      )
    case 'error':
      return (
        <main className="shell">
          <p className="error">{state.message}</p>
        </main>
      )
    case 'anonymous':
      return (
        <AuthScreen
          status={state.status}
          onSignedIn={(user) => setState({ kind: 'signedIn', user })}
        />
      )
    case 'signedIn':
      return <Account user={state.user} onSignedOut={() => void bootstrap()} />
  }
}
