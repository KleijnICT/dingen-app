import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthScreen } from './AuthScreen.js'
import { type AuthStatus, api, errorText, type User } from './api.js'
import { Shell } from './Shell.js'
import { EngineContext } from './store/context.js'
import { SyncEngine } from './store/engine.js'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'anonymous'; status: AuthStatus }
  | { kind: 'signedIn'; user: User; engine: SyncEngine }

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  // signIn en bootstrap verwijzen naar elkaar; de ref breekt de cirkel.
  const bootstrapRef = useRef<() => Promise<void>>(async () => {})

  const signIn = useCallback((user: User) => {
    const engine = new SyncEngine({ userId: user.id })
    engine.onUnauthorized = () => {
      engine.stop()
      void bootstrapRef.current()
    }
    void engine.start()
    setState({ kind: 'signedIn', user, engine })
  }, [])

  const bootstrap = useCallback(async () => {
    try {
      const status = await api.get<AuthStatus>('/api/auth/status')
      try {
        const { user } = await api.get<{ user: User }>('/api/auth/me')
        signIn(user)
      } catch {
        setState({ kind: 'anonymous', status })
      }
    } catch (err) {
      setState({ kind: 'error', message: errorText(err) })
    }
  }, [signIn])

  bootstrapRef.current = bootstrap

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    if (state.kind !== 'signedIn') return
    const { engine } = state
    return () => engine.stop()
  }, [state])

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
      return <AuthScreen status={state.status} onSignedIn={signIn} />
    case 'signedIn':
      return (
        <EngineContext.Provider value={state.engine}>
          <Shell user={state.user} onSignedOut={() => void bootstrap()} />
        </EngineContext.Provider>
      )
  }
}
