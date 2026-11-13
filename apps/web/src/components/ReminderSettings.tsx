import { useEffect, useState } from 'react'
import { useT } from '../i18n/index.js'
import {
  disablePush,
  enablePush,
  PushDeniedError,
  pushSupport,
  refreshSubscription,
  sendTestPush,
} from '../push.js'

type State = 'loading' | 'off' | 'on' | 'busy'

/** Settings → General: reminders on this device (web push), on or off. */
export function ReminderSettings() {
  const t = useT()
  const support = pushSupport()
  const [state, setState] = useState<State>('loading')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (support !== 'ok') return
    let alive = true
    refreshSubscription()
      .then((on) => alive && setState(on ? 'on' : 'off'))
      .catch(() => alive && setState('off'))
    return () => {
      alive = false
    }
  }, [support])

  if (support !== 'ok') {
    return (
      <div className="settings-field reminder-settings">
        <span>{t('reminder.settings.title')}</span>
        <p className="muted">
          {t(
            support === 'proxied'
              ? 'reminder.settings.proxied'
              : support === 'insecure'
                ? 'reminder.settings.insecure'
                : 'reminder.settings.unsupported',
          )}
        </p>
      </div>
    )
  }

  async function toggle(on: boolean) {
    setState('busy')
    setMessage(null)
    try {
      if (on) await enablePush()
      else await disablePush()
      setState(on ? 'on' : 'off')
    } catch (err) {
      setMessage(
        t(err instanceof PushDeniedError ? 'reminder.settings.denied' : 'reminder.settings.failed'),
      )
      setState(on ? 'off' : 'on')
    }
  }

  async function test() {
    setMessage(null)
    try {
      const sent = await sendTestPush(
        t('reminder.settings.testTitle'),
        t('reminder.settings.testBody'),
      )
      if (sent === 0) setMessage(t('reminder.settings.failed'))
    } catch {
      setMessage(t('reminder.settings.failed'))
    }
  }

  return (
    <div className="settings-field reminder-settings">
      <span>{t('reminder.settings.title')}</span>
      <label className="reminder-switch">
        <input
          type="checkbox"
          checked={state === 'on'}
          disabled={state === 'loading' || state === 'busy'}
          onChange={(e) => void toggle(e.target.checked)}
        />
        {t('reminder.settings.device')}
      </label>
      <p className="muted">{t('reminder.settings.help')}</p>
      {state === 'on' && (
        <div>
          <button type="button" onClick={() => void test()}>
            {t('reminder.settings.test')}
          </button>
        </div>
      )}
      {message && <p className="error">{message}</p>}
    </div>
  )
}
