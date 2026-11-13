import { APP_NAME, type EntityType } from '@dingen/core'
import {
  ArrowDownUp,
  Bot,
  CalendarDays,
  Info,
  Settings as SettingsIcon,
  Ticket,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, errorText, type User } from './api.js'
import { withBase } from './base.js'
import { AgentSettings } from './components/AgentSettings.js'
import { CalendarSettings } from './components/CalendarSettings.js'
import { InvitationSettings } from './components/InvitationSettings.js'
import { ReminderSettings } from './components/ReminderSettings.js'
import { LOCALES, type Locale, setLocale, useLocale, useT } from './i18n/index.js'

const TABS = [
  { id: 'general', icon: SettingsIcon },
  { id: 'account', icon: UserRound },
  { id: 'agents', icon: Bot },
  { id: 'calendars', icon: CalendarDays },
  { id: 'data', icon: ArrowDownUp },
  // --- uitnodigingen: alleen voor de beheerder ---
  { id: 'invitations', icon: Ticket, adminOnly: true },
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
          {TABS.filter((tab) => !('adminOnly' in tab) || user.isAdmin).map(({ id, icon: Icon }) => (
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
          {tab === 'agents' && <AgentSettings />}
          {tab === 'calendars' && <CalendarSettings />}
          {tab === 'data' && <DataTab />}
          {tab === 'invitations' && user.isAdmin && <InvitationSettings />}
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
      <ReminderSettings />
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
        <a className="button" href={withBase('/api/export')} download>
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
