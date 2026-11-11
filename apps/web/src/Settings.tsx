import { APP_NAME, type EntityType } from '@dingen/core'
import {
  ArrowDownUp,
  CalendarDays,
  Info,
  Plug,
  Settings as SettingsIcon,
  UserRound,
  X,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, type ApiTokenInfo, api, errorText, type User } from './api.js'
import { CalendarSettings } from './components/CalendarSettings.js'
import { formatDate, LOCALES, type Locale, setLocale, useLocale, useT } from './i18n/index.js'

const TABS = [
  { id: 'general', icon: SettingsIcon },
  { id: 'account', icon: UserRound },
  { id: 'connections', icon: Plug },
  { id: 'calendars', icon: CalendarDays },
  { id: 'data', icon: ArrowDownUp },
  { id: 'about', icon: Info },
] as const
type TabId = (typeof TABS)[number]['id']

interface Props {
  user: User
  onSignedOut: () => void
  onClose: () => void
}

/** The settings window: a dialog over the app with a tab per subject. */
export function Settings({ user, onSignedOut, onClose }: Props) {
  const t = useT()
  const [tab, setTab] = useState<TabId>('general')
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="settings-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
      >
        <header className="settings-head">
          <h1>{t(`settings.tab.${tab}`)}</h1>
          <button
            type="button"
            className="settings-close"
            aria-label={t('settings.close')}
            title={t('settings.close')}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="settings-tabs" role="tablist">
          {TABS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`settings-tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
              <span>{t(`settings.tab.${id}`)}</span>
            </button>
          ))}
        </div>
        <div className="settings-body" role="tabpanel">
          {tab === 'general' && <General />}
          {tab === 'account' && <Account user={user} onSignedOut={onSignedOut} />}
          {tab === 'connections' && <Connections />}
          {tab === 'calendars' && <CalendarSettings />}
          {tab === 'data' && <DataTab />}
          {tab === 'about' && <About />}
        </div>
      </div>
    </div>
  )
}

function General() {
  const t = useT()
  const locale = useLocale()
  return (
    <div className="settings-form">
      <label className="settings-field">
        <span>{t('account.language')}</span>
        <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
          {(Object.keys(LOCALES) as Locale[]).map((code) => (
            <option key={code} value={code}>
              {LOCALES[code].name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function Account({ user, onSignedOut }: { user: User; onSignedOut: () => void }) {
  const t = useT()
  async function logout() {
    await api.post('/api/auth/logout')
    onSignedOut()
  }
  return (
    <div className="settings-form">
      <p>{t('account.signedInAs', { email: user.email, app: APP_NAME })}</p>
      <div>
        <button type="button" onClick={logout}>
          {t('account.signOut')}
        </button>
      </div>
    </div>
  )
}

function Connections() {
  const t = useT()
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

  return (
    <div className="settings-form">
      <p className="muted">{t('account.tokens.intro')}</p>
      <form className="row" onSubmit={createToken}>
        <input
          type="text"
          placeholder={t('account.tokens.namePlaceholder')}
          aria-label={t('account.tokens.namePlaceholder')}
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
    </div>
  )
}

interface ImportSummary {
  counts: Record<EntityType, { created: number; updated: number; unchanged: number }>
  total: { created: number; updated: number; unchanged: number }
}

const DATA_TYPES: EntityType[] = ['area', 'project', 'heading', 'task', 'checklistItem', 'tag']

/** Export and import of all data as one JSON file. */
function DataTab() {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; body: unknown } | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    setResult(null)
    setError(null)
    setPending(null)
    if (input.current) input.current.value = ''
    if (!file) return
    try {
      setPending({ name: file.name, body: JSON.parse(await file.text()) })
    } catch {
      setError(t('data.import.failed', { reason: t('data.import.notJson') }))
    }
  }

  async function runImport() {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.post<ImportSummary>('/api/import?mode=merge', pending.body))
      setPending(null)
    } catch (err) {
      let reason = errorText(err)
      if (err instanceof ApiError && err.code === 'invalid_export') {
        reason = t('data.import.invalid', { issue: err.issues[0] ?? '?' })
      } else if (err instanceof ApiError && err.code === 'too_large') {
        reason = t('data.import.tooLarge')
      }
      setError(t('data.import.failed', { reason }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-form data-tab">
      <section>
        <h2>{t('data.export.title')}</h2>
        <p className="muted">{t('data.export.intro')}</p>
        <a className="button" href="/api/export" download>
          {t('data.export.button')}
        </a>
      </section>
      <section>
        <h2>{t('data.import.title')}</h2>
        <p className="muted">{t('data.import.intro')}</p>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        {!pending && (
          <div>
            <button type="button" onClick={() => input.current?.click()} disabled={busy}>
              {t('data.import.choose')}
            </button>
          </div>
        )}
        {pending && (
          <div className="data-confirm" role="alertdialog" aria-label={t('data.import.title')}>
            <p>{t('data.import.confirm', { name: pending.name })}</p>
            <div className="row">
              <button type="button" onClick={runImport} disabled={busy}>
                {busy ? t('data.import.working') : t('data.import.confirmButton')}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => setPending(null)}
                disabled={busy}
              >
                {t('data.import.cancel')}
              </button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {result && (
          <div role="status">
            <p>{t('data.import.done', result.total)}</p>
            <table className="data-counts">
              <tbody>
                {DATA_TYPES.map((type) => {
                  const c = result.counts[type]
                  return (
                    <tr key={type}>
                      <th scope="row">{t(`data.type.${type}`)}</th>
                      <td>
                        {c.created} / {c.updated} / {c.unchanged}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function About() {
  const t = useT()
  return (
    <dl className="settings-about">
      <dt>{t('settings.version')}</dt>
      <dd>{__DINGEN_VERSION__}</dd>
      <dt>{t('settings.build')}</dt>
      <dd>{__DINGEN_BUILD__ ?? '–'}</dd>
      <dt>{t('settings.source')}</dt>
      <dd>
        <a href="https://github.com/KleijnICT/dingen-app" target="_blank" rel="noreferrer">
          github.com/KleijnICT/dingen-app
        </a>
      </dd>
    </dl>
  )
}
