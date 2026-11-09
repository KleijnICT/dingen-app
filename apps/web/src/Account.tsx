import { APP_NAME } from '@dingen/core'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { type ApiTokenInfo, api, errorText, type User } from './api.js'

interface Props {
  user: User
  onSignedOut: () => void
}

export function Account({ user, onSignedOut }: Props) {
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([])
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { tokens } = await api.get<{ tokens: ApiTokenInfo[] }>('/api/auth/tokens')
      setTokens(tokens)
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createToken(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const { token, info } = await api.post<{ token: string; info: ApiTokenInfo }>(
        '/api/auth/tokens',
        {
          name,
        },
      )
      setFresh({ name: info.name, token })
      setName('')
      await load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function revoke(id: string) {
    setError(null)
    try {
      await api.delete(`/api/auth/tokens/${id}`)
      await load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function logout() {
    await api.post('/api/auth/logout')
    onSignedOut()
  }

  return (
    <section className="list-page account-page">
      <header className="list-header row">
        <h1>Account</h1>
        <button type="button" className="link" onClick={logout}>
          Uitloggen
        </button>
      </header>
      <p className="muted">
        Ingelogd als {user.email} bij {APP_NAME}.
      </p>
      <section className="card wide">
        <h2>API-tokens</h2>
        <p className="muted">
          Voor Claude, de MCP-server en toekomstige apps. Een token zie je maar één keer.
        </p>
        <form className="row" onSubmit={createToken}>
          <input
            type="text"
            placeholder="Naam, bijv. Claude op de Mac"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <button type="submit">Token maken</button>
        </form>
        {fresh && (
          <div className="token-reveal">
            <p>
              Token voor <strong>{fresh.name}</strong>. Kopieer hem nu; hij wordt niet opnieuw
              getoond.
            </p>
            <code>{fresh.token}</code>
            <button type="button" className="link" onClick={() => setFresh(null)}>
              Gekopieerd, verbergen
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <ul className="tokens">
          {tokens.length === 0 && <li className="muted">Nog geen tokens.</li>}
          {tokens.map((t) => (
            <li key={t.id} className="row">
              <span>
                <strong>{t.name}</strong> <code>{t.prefix}…</code>
                <span className="muted">
                  {' '}
                  {t.lastUsedAt
                    ? `laatst gebruikt ${formatDate(t.lastUsedAt)}`
                    : 'nog niet gebruikt'}
                </span>
              </span>
              <button type="button" className="link danger" onClick={() => revoke(t.id)}>
                Intrekken
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
}
