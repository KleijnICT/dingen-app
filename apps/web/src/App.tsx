import { APP_NAME, type HealthStatus } from '@dingen/core'
import { useEffect, useState } from 'react'

type Health =
  | { state: 'loading' }
  | { state: 'ok'; data: HealthStatus }
  | { state: 'error'; message: string }

export function App() {
  const [health, setHealth] = useState<Health>({ state: 'loading' })

  useEffect(() => {
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setHealth({ state: 'ok', data: (await res.json()) as HealthStatus })
      })
      .catch((err: unknown) => {
        setHealth({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      })
  }, [])

  return (
    <main className="shell">
      <h1>{APP_NAME}</h1>
      <p className="status" data-state={health.state}>
        {health.state === 'loading' && 'Verbinden met server…'}
        {health.state === 'ok' &&
          `Server ${health.data.version}, SQLite ${health.data.sqliteVersion}`}
        {health.state === 'error' && `Geen verbinding: ${health.message}`}
      </p>
    </main>
  )
}
