import {
  Ban,
  Download,
  KeyRound,
  LockOpen,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserRound,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ApiError, api, errorText, type RegistrationMode, type User } from '../api.js'
import { currentBase, withBase } from '../base.js'
import { formatDate, type MessageKey, useT } from '../i18n/index.js'
import { resetLink as buildResetLink } from '../reset.js'
import { EmptyState } from './EmptyState.js'
import { InvitationSettings } from './InvitationSettings.js'
import { type MenuItem, MoreMenu } from './Menu.js'

/**
 * Settings → Administration (plan 32), only for administrators: the accounts,
 * who may register, the back-ups and the mail status. Each section loads on
 * its own; a section whose route the server does not have (404) is left out,
 * so this works against servers without mail or two-step verification.
 */
export function AdminSettings({ me }: { me: User }) {
  const [mail, setMail] = useState<MailStatus | null | undefined>(undefined)
  // Deleting an account makes a back-up: the list loads again.
  const [backupsVersion, setBackupsVersion] = useState(0)

  useEffect(() => {
    let live = true
    api
      .get<MailStatus>('/api/admin/mail')
      .then((status) => live && setMail(status))
      .catch(() => live && setMail(null))
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="settings-form admin-tab">
      <Users me={me} onDeleted={() => setBackupsVersion((v) => v + 1)} />
      <Registration />
      <Backups version={backupsVersion} />
      {mail && <Mail status={mail} me={me} />}
    </div>
  )
}

// --- users ---

interface AdminUser {
  id: string
  email: string
  createdAt: string
  isAdmin: boolean
  blockedAt: string | null
  lastActiveAt: string | null
  homeAssistant: boolean
  hasPassword: boolean
  /** Two-step verification is on. */
  totpEnabled: boolean
}

const ADMIN_ERRORS = new Set([
  'self',
  'last_admin',
  'not_blocked',
  'confirm_mismatch',
  'shared_space',
])

function adminError(err: unknown, t: ReturnType<typeof useT>): string {
  if (err instanceof ApiError && ADMIN_ERRORS.has(err.code)) {
    return t(`admin.error.${err.code}` as MessageKey)
  }
  if (err instanceof ApiError && err.code === 'invalid_backup') {
    return t('admin.error.invalid_backup', { reason: err.issues[0] ?? '?' })
  }
  return errorText(err)
}

/** A route that this server does not have: hide the control that uses it. */
const missingRoute = (err: unknown) =>
  err instanceof ApiError && err.status === 404 && err.code === 'not_found'

const day = (iso: string) => formatDate(new Date(iso), { dateStyle: 'medium' })
const moment = (iso: string) =>
  formatDate(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' })

function Users({ me, onDeleted }: { me: User; onDeleted: () => void }) {
  const t = useT()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reset, setReset] = useState<{ email: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)
  // Controls whose route turned out to be missing on this server.
  const [noResetLink, setNoResetLink] = useState(false)
  const [noTotp, setNoTotp] = useState(false)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)

  const load = useCallback(async () => {
    try {
      setUsers((await api.get<{ users: AdminUser[] }>('/api/admin/users')).users)
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(run: () => Promise<unknown>, done?: string) {
    setError(null)
    setNotice(null)
    try {
      await run()
      if (done) setNotice(done)
      await load()
    } catch (err) {
      setError(adminError(err, t))
    }
  }

  const patch = (u: AdminUser, body: { isAdmin?: boolean; blocked?: boolean }) =>
    act(() => api.patch(`/api/admin/users/${u.id}`, body))

  async function resetLink(u: AdminUser) {
    setError(null)
    setNotice(null)
    setCopied(false)
    try {
      const body = await api.post<{ token: string; url: string; expiresAt: string }>(
        `/api/admin/users/${u.id}/reset-link`,
      )
      // The address this browser uses, with the ingress base path when there is one.
      setReset({
        email: u.email,
        link: buildResetLink(window.location.origin + currentBase(), body.token),
      })
    } catch (err) {
      if (missingRoute(err)) setNoResetLink(true)
      else setError(adminError(err, t))
    }
  }

  async function totpOff(u: AdminUser) {
    setError(null)
    setNotice(null)
    try {
      await api.post(`/api/admin/users/${u.id}/totp/disable`)
      setNotice(t('admin.users.totpOffDone', { email: u.email }))
      await load()
    } catch (err) {
      if (missingRoute(err)) setNoTotp(true)
      else setError(adminError(err, t))
    }
  }

  async function copy() {
    if (!reset) return
    try {
      await navigator.clipboard.writeText(reset.link)
      setCopied(true)
    } catch {
      // No clipboard (plain HTTP): the link can be selected by hand.
    }
  }

  function items(u: AdminUser): MenuItem[] {
    const list: MenuItem[] = []
    if (!noResetLink && !u.blockedAt) {
      list.push({
        label: t('admin.users.resetLink'),
        icon: KeyRound,
        onSelect: () => void resetLink(u),
      })
    }
    if (!noTotp && u.totpEnabled) {
      list.push({
        label: t('admin.users.totpOff'),
        icon: ShieldOff,
        confirm: t('admin.users.totpOffQuestion', { email: u.email }),
        onSelect: () => void totpOff(u),
      })
    }
    if (u.id === me.id) return list
    list.push(
      u.isAdmin
        ? {
            label: t('admin.users.unmakeAdmin'),
            icon: UserRound,
            onSelect: () => void patch(u, { isAdmin: false }),
          }
        : {
            label: t('admin.users.makeAdmin'),
            icon: ShieldCheck,
            onSelect: () => void patch(u, { isAdmin: true }),
          },
    )
    if (u.blockedAt) {
      list.push({
        label: t('admin.users.unblock'),
        icon: LockOpen,
        onSelect: () => void patch(u, { blocked: false }),
      })
      list.push({
        label: t('admin.users.delete'),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          setError(null)
          setNotice(null)
          setDeleting(u)
        },
      })
    } else {
      list.push({
        label: t('admin.users.block'),
        icon: Ban,
        danger: true,
        confirm: t('admin.users.blockQuestion', { email: u.email }),
        onSelect: () => void patch(u, { blocked: true }),
      })
    }
    return list
  }

  return (
    <section>
      <h2>{t('admin.users.title')}</h2>
      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {reset && (
        <div className="token-reveal" role="status">
          <p>{t('admin.users.resetReveal', { email: reset.email })}</p>
          <code>{reset.link}</code>
          <div className="row agent-token-actions">
            <button type="button" className="button-secondary" onClick={copy}>
              {copied ? t('invite.copied') : t('invite.copy')}
            </button>
            <button type="button" className="link" onClick={() => setReset(null)}>
              {t('invite.hide')}
            </button>
          </div>
        </div>
      )}
      {deleting && (
        <DeleteForm
          key={deleting.id}
          user={deleting}
          onCancel={() => setDeleting(null)}
          onDone={(text) => {
            setDeleting(null)
            setNotice(text)
            onDeleted()
            void load()
          }}
        />
      )}
      {users === null && !error && <p className="page-status">{t('app.loading')}</p>}
      {users && (
        <ul className="agent-list admin-list">
          {users.map((u) => {
            const menu = items(u)
            return (
              <li key={u.id} className="agent-item">
                <div className="agent-main">
                  <strong className="admin-email">
                    {u.email}
                    {u.id === me.id && <span className="muted"> {t('admin.users.you')}</span>}
                  </strong>
                  <span className="muted admin-meta">
                    {[
                      u.isAdmin && t('admin.users.admin'),
                      u.blockedAt && t('admin.users.blocked', { date: day(u.blockedAt) }),
                      u.homeAssistant && 'Home Assistant',
                      u.totpEnabled && t('admin.users.totp'),
                      t('admin.users.joined', { date: day(u.createdAt) }),
                      u.lastActiveAt
                        ? t('admin.users.lastActive', { date: moment(u.lastActiveAt) })
                        : t('admin.users.neverActive'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                {menu.length > 0 && (
                  <MoreMenu
                    alignEnd
                    label={t('admin.users.actions', { email: u.email })}
                    items={menu}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Deleting for good: type the account's e-mail address, then confirm. */
function DeleteForm({
  user,
  onDone,
  onCancel,
}: {
  user: AdminUser
  onDone: (text: string) => void
  onCancel: () => void
}) {
  const t = useT()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!matches) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.delete<{ backup: string | null }>(`/api/admin/users/${user.id}`, {
        confirm: typed,
      })
      onDone(t('admin.users.deleted', { email: user.email, file: res.backup ?? '–' }))
    } catch (err) {
      setError(adminError(err, t))
      setBusy(false)
    }
  }

  return (
    <form
      className="admin-confirm"
      role="alertdialog"
      aria-label={t('admin.users.delete')}
      onSubmit={submit}
    >
      <p>{t('admin.users.deleteQuestion', { email: user.email })}</p>
      <input
        type="email"
        autoComplete="off"
        aria-label={t('admin.users.deleteType')}
        placeholder={user.email}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <div className="row admin-confirm-actions">
        <button type="submit" className="button-danger" disabled={!matches || busy}>
          {t('admin.users.deleteConfirm')}
        </button>
        <button type="button" className="link" onClick={onCancel} disabled={busy}>
          {t('confirm.cancel')}
        </button>
      </div>
    </form>
  )
}

// --- registration ---

const MODES: RegistrationMode[] = ['closed', 'invite', 'open']

function Registration() {
  const t = useT()
  const [mode, setMode] = useState<RegistrationMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ mode: RegistrationMode }>('/api/admin/registration')
      .then((r) => setMode(r.mode))
      .catch((err) => setError(errorText(err)))
  }, [])

  async function choose(next: RegistrationMode) {
    const before = mode
    setMode(next)
    setError(null)
    try {
      await api.put('/api/admin/registration', { mode: next })
    } catch (err) {
      setMode(before)
      setError(errorText(err))
    }
  }

  return (
    <section>
      <h2>{t('admin.registration.title')}</h2>
      {mode && (
        <>
          <label className="settings-field">
            <span>{t('admin.registration.label')}</span>
            <select value={mode} onChange={(e) => void choose(e.target.value as RegistrationMode)}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`admin.registration.${m}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">{t(`admin.registration.${mode}Help`)}</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {mode === 'invite' && <InvitationSettings />}
    </section>
  )
}

// --- back-ups ---

type BackupKind = 'daily' | 'pre-update' | 'pre-restore' | 'pre-delete' | 'manual'

interface BackupInfo {
  name: string
  kind: BackupKind
  at: string
  schema: string
  size: number
}

const SHOWN = 8

function size(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let unit = 0
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024
    unit += 1
  }
  return `${unit === 0 ? n : n.toFixed(1)} ${units[unit]}`
}

/** Waits until the server answers again after a restore, then loads the app afresh. */
async function reloadWhenBack(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500))
  for (;;) {
    try {
      const res = await fetch(withBase('/api/health'), { cache: 'no-store' })
      if (res.ok) break
    } catch {
      // Not back yet.
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  window.location.reload()
}

function Backups({ version }: { version: number }) {
  const t = useT()
  const [list, setList] = useState<{ backups: BackupInfo[]; canRestore: boolean } | null>(null)
  const [missing, setMissing] = useState(false)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [asking, setAsking] = useState<BackupInfo | null>(null)
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(async () => {
    try {
      setList(await api.get('/api/admin/backups'))
    } catch (err) {
      if (missingRoute(err)) setMissing(true)
      else setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void version
    void load()
  }, [load, version])

  async function backUpNow() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.post('/api/admin/backups')
      setNotice(t('admin.backups.made'))
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (missing) return null
  const backups = list?.backups ?? []
  const shown = all ? backups : backups.slice(0, SHOWN)

  return (
    <section>
      <h2>{t('admin.backups.title')}</h2>
      <p className="muted">{t('admin.backups.intro')}</p>
      <div>
        <button
          type="button"
          className="button-secondary"
          onClick={backUpNow}
          disabled={busy || restoring}
        >
          {busy ? t('admin.backups.working') : t('admin.backups.now')}
        </button>
      </div>
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {restoring && (
        <p className="page-status" role="status">
          {t('admin.backups.restoring')}
        </p>
      )}
      {asking && !restoring && (
        <RestoreForm
          backup={asking}
          onCancel={() => setAsking(null)}
          onStarted={() => {
            setRestoring(true)
            void reloadWhenBack()
          }}
        />
      )}
      {list && backups.length === 0 && (
        <EmptyState title={t('admin.backups.none')} text={t('admin.backups.noneText')} />
      )}
      {backups.length > 0 && (
        <ul className="agent-list admin-list">
          {shown.map((b) => (
            <li key={b.name} className="agent-item">
              <div className="agent-main">
                <span>{moment(b.at)}</span>
                <span className="muted admin-meta">
                  {t(`admin.backups.kind.${b.kind}`)} · {size(b.size)}
                </span>
              </div>
              <a
                className="icon-button"
                href={withBase(`/api/admin/backups/${encodeURIComponent(b.name)}`)}
                download={b.name}
                aria-label={t('admin.backups.download')}
                title={t('admin.backups.download')}
              >
                <Download size={16} aria-hidden="true" />
              </a>
              {list?.canRestore && (
                <button
                  type="button"
                  className={`icon-button ${asking?.name === b.name ? 'on' : ''}`}
                  aria-label={t('admin.backups.restore')}
                  title={t('admin.backups.restore')}
                  disabled={restoring}
                  onClick={() => setAsking(asking?.name === b.name ? null : b)}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!all && backups.length > SHOWN && (
        <div>
          <button type="button" className="link" onClick={() => setAll(true)}>
            {t('admin.backups.showAll', { count: backups.length })}
          </button>
        </div>
      )}
    </section>
  )
}

/** Restoring the whole server: type the word, then confirm. */
function RestoreForm({
  backup,
  onCancel,
  onStarted,
}: {
  backup: BackupInfo
  onCancel: () => void
  onStarted: () => void
}) {
  const t = useT()
  const word = t('admin.backups.restoreWord')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = typed.trim().toLowerCase() === word.toLowerCase()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!matches) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/admin/backups/${encodeURIComponent(backup.name)}/restore`)
      onStarted()
    } catch (err) {
      setError(adminError(err, t))
      setBusy(false)
    }
  }

  return (
    <form
      className="admin-confirm data-confirm"
      role="alertdialog"
      aria-label={t('admin.backups.restore')}
      onSubmit={submit}
    >
      <p>{t('admin.backups.restoreQuestion', { date: moment(backup.at) })}</p>
      <label className="settings-field admin-confirm-field">
        <span>{t('admin.backups.restoreType', { word })}</span>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row admin-confirm-actions">
        <button type="submit" className="button-danger" disabled={!matches || busy}>
          {t('admin.backups.restore')}
        </button>
        <button type="button" className="link" onClick={onCancel} disabled={busy}>
          {t('confirm.cancel')}
        </button>
      </div>
    </form>
  )
}

// --- mail ---

interface MailStatus {
  configured: boolean
  from?: string | null
}

function Mail({ status, me }: { status: MailStatus; me: User }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function test() {
    setBusy(true)
    setResult(null)
    try {
      const res = await api.post<{ to?: string }>('/api/admin/mail/test')
      setResult({ ok: true, text: t('admin.mail.testSent', { email: res.to ?? me.email }) })
    } catch (err) {
      setResult({ ok: false, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>{t('admin.mail.title')}</h2>
      <p className="muted">
        {status.configured
          ? t('admin.mail.configured', { from: status.from ?? '–' })
          : t('admin.mail.notConfigured')}
      </p>
      {status.configured && (
        <div>
          <button type="button" className="button-secondary" onClick={test} disabled={busy}>
            {t('admin.mail.test')}
          </button>
        </div>
      )}
      {result && (
        <p className={result.ok ? 'muted' : 'error'} role="status">
          {result.text}
        </p>
      )}
    </section>
  )
}
