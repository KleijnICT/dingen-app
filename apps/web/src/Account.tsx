import { APP_NAME } from '@dingen/core'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { type ApiTokenInfo, api, errorText, type User } from './api.js'
import { formatDate, LOCALES, type Locale, setLocale, useLocale, useT } from './i18n/index.js'

interface Props {
  user: User
  onSignedOut: () => void
}

export function Account({ user, onSignedOut }: Props) {
  const t = useT()
  const locale = useLocale()
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
        { name },
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
        <h1>{t('account.title')}</h1>
        <button type="button" className="link" onClick={logout}>
          {t('account.signOut')}
        </button>
      </header>
      <p className="muted">{t('account.signedInAs', { email: user.email, app: APP_NAME })}</p>

      <section className="card wide">
        <h2>{t('account.language')}</h2>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          aria-label={t('account.language')}
        >
          {(Object.keys(LOCALES) as Locale[]).map((code) => (
            <option key={code} value={code}>
              {LOCALES[code].name}
            </option>
          ))}
        </select>

        <h2>{t('account.tokens')}</h2>
        <p className="muted">{t('account.tokens.intro')}</p>
        <form className="row" onSubmit={createToken}>
          <input
            type="text"
            placeholder={t('account.tokens.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <button type="submit">{t('account.tokens.create')}</button>
        </form>
        {fresh && (
          <div className="token-reveal">
            <p>{t('account.tokens.reveal', { name: fresh.name })}</p>
            <code>{fresh.token}</code>
            <button type="button" className="link" onClick={() => setFresh(null)}>
              {t('account.tokens.hide')}
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <ul className="tokens">
          {tokens.length === 0 && <li className="muted">{t('account.tokens.none')}</li>}
          {tokens.map((tok) => (
            <li key={tok.id} className="row">
              <span>
                <strong>{tok.name}</strong> <code>{tok.prefix}…</code>
                <span className="muted">
                  {' '}
                  {tok.lastUsedAt
                    ? t('account.tokens.lastUsed', {
                        date: formatDate(new Date(tok.lastUsedAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      })
                    : t('account.tokens.unused')}
                </span>
              </span>
              <button type="button" className="link danger" onClick={() => revoke(tok.id)}>
                {t('account.tokens.revoke')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
