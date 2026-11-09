import { useState } from 'react'
import { useT } from '../i18n/index.js'

interface Props {
  label: string
  question: string
  onConfirm: () => void
}

/** A destructive link that asks once, inline, before it acts. */
export function ConfirmButton({ label, question, onConfirm }: Props) {
  const t = useT()
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" className="link danger" onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="confirm">
      <span className="confirm-question">{question}</span>
      <button type="button" className="link danger" onClick={onConfirm}>
        {label}
      </button>
      <button type="button" className="link" onClick={() => setAsking(false)}>
        {t('confirm.cancel')}
      </button>
    </span>
  )
}
