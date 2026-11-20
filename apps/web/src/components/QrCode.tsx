import { useMemo } from 'react'
import { encode } from 'uqr'

/**
 * A QR code drawn here, in the browser: the text (a two-step secret) never
 * goes to another service. Dark modules on a light tile in both themes,
 * because cameras read that best.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 })
    let d = ''
    qr.data.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`
      })
    })
    return { size: qr.size, path: d }
  }, [text])
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <title>{label}</title>
      <rect width={size} height={size} className="qr-code-tile" />
      <path d={path} className="qr-code-modules" />
    </svg>
  )
}
