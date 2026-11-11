import { useCallback, useEffect, useState } from 'react'
import { type AuthStatus, api, errorText, type RegistrationMode } from '../api.js'
import { formatDate, useT } from '../i18n/index.js'
import { inviteLink } from '../invite.js'

type InvitationStatus = 'open' | 'used' | 'expired' | 'revoked'

interface Invitation {
  id: string
  createdAt: string
  expiresAt: string
  createdBy: string | null
  usedAt: string | null
  usedBy: string | null
  revokedAt: string | null
  status: InvitationStatus
}

const day = (iso: string) => formatDate(new Date(iso), { dateStyle: 'medium' })

/**
 * Tabblad "Invitations" (alleen voor de beheerder): een eenmalige link maken
 * en kopiëren, de lijst met status zien en open uitnodigingen intrekken. De
 * link is maar één keer te zien; de server bewaart alleen een hash.
 */
export function InvitationSettings() {
  const t = useT()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [mode, setMode] = useState<RegistrationMode | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([
        api.get<{ invitations: Invitation[] }>('/api/invitations'),
        api.get<AuthStatus>('/api/auth/status'),
      ])
      setInvitations(list.invitations)
      setMode(status.registration ?? 'closed')
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    setError(null)
    setCopied(false)
    setBusy(true)
    try {
      const { token } = await api.post<{ token: string }>('/api/invitations')
      setFresh(inviteLink(window.location.origin, token))
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!fresh) return
    try {
      await navigator.clipboard.writeText(fresh)
      setCopied(true)
    } catch {
      // Clipboard not available (e.g. plain HTTP): the link is selectable by hand.
      setCopied(false)
    }
  }

  async function revoke(id: string) {
    setError(null)
    try {
      await api.delete(`/api/invitations/${id}`)
      await load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  function statusText(inv: Invitation): string {
    switch (inv.status) {
      case 'open':
        return t('invite.status.open', { date: day(inv.expiresAt) })
      case 'used':
        return t('invite.status.used', {
          email: inv.usedBy ?? t('invite.removedAccount'),
          date: day(inv.usedAt ?? inv.createdAt),
        })
      case 'expired':
        return t('invite.status.expired', { date: day(inv.expiresAt) })
      case 'revoked':
        return t('invite.status.revoked', { date: day(inv.revokedAt ?? inv.createdAt) })
    }
  }

  return (
    <div className="settings-form">
      <p className="muted">{t('invite.intro')}</p>
      {mode && mode !== 'invite' && (
        <p className="invite-mode">
          {t(mode === 'open' ? 'invite.modeOpen' : 'invite.modeClosed')}
        </p>
      )}
      <div>
        <button type="button" onClick={create} disabled={busy}>
          {t('invite.create')}
        </button>
      </div>
      {fresh && (
        <div className="token-reveal">
          <p>{t('invite.reveal')}</p>
          <code>{fresh}</code>
          <div className="row">
            <button type="button" onClick={copy}>
              {copied ? t('invite.copied') : t('invite.copy')}
            </button>
            <button type="button" className="link" onClick={() => setFresh(null)}>
              {t('invite.hide')}
            </button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <ul className="tokens">
        {invitations.length === 0 && <li className="muted">{t('invite.none')}</li>}
        {invitations.map((inv) => (
          <li key={inv.id} className="row">
            <span>
              <strong>{t('invite.createdOn', { date: day(inv.createdAt) })}</strong>{' '}
              <span className={`invite-status invite-${inv.status}`}>{statusText(inv)}</span>
            </span>
            {inv.status === 'open' && (
              <button type="button" className="link danger" onClick={() => revoke(inv.id)}>
                {t('invite.revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
