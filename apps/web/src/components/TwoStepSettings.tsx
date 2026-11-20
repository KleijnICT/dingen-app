import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ApiError, api, errorText } from '../api.js'
import { useT } from '../i18n/index.js'
import { QrCode } from './QrCode.js'

interface Status {
  enabled: boolean
  recoveryCodesLeft: number
}

type Step =
  | { kind: 'idle' }
  | { kind: 'setup'; secret: string; uri: string }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'turnOff' }

/** The secret in groups of four, easier to type over. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

/**
 * Settings → Account → Two-step verification (plan 32): turn on with a QR code
 * and a code from the app, see the ten recovery codes once, turn off with the
 * password or a code. The secret is shown only during setup.
 */
export function TwoStepSettings() {
  const t = useT()
  const [status, setStatus] = useState<Status | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [code, setCode] = useState('')
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<Status>('/api/auth/two-step'))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function go(next: Step) {
    setStep(next)
    setCode('')
    setProof('')
    setError(null)
    setCopied(false)
  }

  async function begin() {
    setBusy(true)
    setError(null)
    try {
      const { secret, uri } = await api.post<{ secret: string; uri: string }>(
        '/api/auth/two-step/setup',
      )
      go({ kind: 'setup', secret, uri })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { recoveryCodes } = await api.post<{ recoveryCodes: string[] }>(
        '/api/auth/two-step/enable',
        { code },
      )
      go({ kind: 'codes', codes: recoveryCodes })
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function turnOff(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Six digits are a code from the app; a password has at least eight characters.
    const value = proof.trim()
    const body = /^\d{3} ?\d{3}$/.test(value) ? { code: value } : { password: proof }
    try {
      await api.post('/api/auth/two-step/disable', body)
      go({ kind: 'idle' })
      await load()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      setError(
        code === 'invalid_credentials' || code === 'invalid_code'
          ? t('twoStep.wrong')
          : errorText(err),
      )
    } finally {
      setBusy(false)
    }
  }

  async function copyCodes(codes: string[]) {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
    } catch {
      // Clipboard not available (plain HTTP): the codes can be selected by hand.
    }
  }

  return (
    <section className="settings-form two-step" aria-labelledby="two-step-title">
      <strong id="two-step-title">{t('twoStep.title')}</strong>
      <p className="muted">{t('twoStep.intro')}</p>

      {step.kind === 'idle' && status && !status.enabled && (
        <div>
          <button type="button" className="button-secondary" onClick={begin} disabled={busy}>
            {t('twoStep.turnOn')}
          </button>
        </div>
      )}

      {step.kind === 'idle' && status?.enabled && (
        <div className="two-step-on">
          <p className="two-step-status">
            {t('twoStep.status', { count: status.recoveryCodesLeft })}
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => go({ kind: 'turnOff' })}
          >
            {t('twoStep.turnOff')}
          </button>
        </div>
      )}

      {step.kind === 'setup' && (
        <form className="settings-form" onSubmit={confirm}>
          <p>{t('twoStep.scan')}</p>
          <div className="two-step-setup">
            <QrCode text={step.uri} label={t('twoStep.qrLabel')} />
            <div className="two-step-key">
              <span className="muted">{t('twoStep.key')}</span>
              <code>{grouped(step.secret)}</code>
            </div>
          </div>
          <label className="settings-field">
            <span>{t('twoStep.confirmCode')}</span>
            <input
              className="code-input"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={7}
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <div className="row two-step-actions">
            <button type="submit" className="button-secondary" disabled={busy}>
              {t('twoStep.confirm')}
            </button>
            <button type="button" className="link" onClick={() => go({ kind: 'idle' })}>
              {t('twoStep.cancel')}
            </button>
          </div>
        </form>
      )}

      {step.kind === 'codes' && (
        <div className="settings-form" role="status">
          <p>{t('twoStep.codesIntro')}</p>
          <ul className="recovery-codes">
            {step.codes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <div className="row two-step-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => void copyCodes(step.codes)}
            >
              {copied ? t('twoStep.copied') : t('twoStep.copy')}
            </button>
            <button type="button" className="link" onClick={() => go({ kind: 'idle' })}>
              {t('twoStep.done')}
            </button>
          </div>
        </div>
      )}

      {step.kind === 'turnOff' && (
        <form className="settings-form" onSubmit={turnOff}>
          <p>{t('twoStep.turnOffPrompt')}</p>
          <label className="settings-field">
            <span>{t('twoStep.passwordOrCode')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              required
              // biome-ignore lint/a11y/noAutofocus: the field the button just asked for
              autoFocus
            />
          </label>
          <div className="row two-step-actions">
            <button type="submit" className="button-danger" disabled={busy}>
              {t('twoStep.turnOff')}
            </button>
            <button type="button" className="link" onClick={() => go({ kind: 'idle' })}>
              {t('twoStep.cancel')}
            </button>
          </div>
        </form>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  )
}
