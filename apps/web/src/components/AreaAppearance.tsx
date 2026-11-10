import { AREA_COLORS, AREA_ICONS, type Area } from '@dingen/core'
import { useEffect, useRef, useState } from 'react'
import { type MessageKey, useT } from '../i18n/index.js'
import { useEngine } from '../store/context.js'
import { AREA_ICON_COMPONENTS, AreaGlyph, areaColorVar, knownColor } from './AreaIcons.js'
import { AreaIcon } from './Icons.js'

/**
 * The button left of an area's title: shows its icon in its colour and opens
 * a popover to choose both. Choices are written immediately.
 */
export function AreaAppearance({ area }: { area: Area }) {
  const engine = useEngine()
  const t = useT()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const icon = area.icon !== null && area.icon in AREA_ICON_COMPONENTS ? area.icon : null
  const color = knownColor(area.color) ?? 'gray'

  return (
    <div className="area-appearance" ref={root}>
      <button
        type="button"
        ref={button}
        className="area-appearance-button"
        aria-label={t('area.appearance')}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <AreaGlyph icon={area.icon} color={area.color} size={26} />
      </button>
      {open && (
        <div className="popover area-picker" role="dialog" aria-label={t('area.appearance')}>
          <div className="icon-grid">
            <button
              type="button"
              className="picker-item"
              aria-label={t('areaIcon.default')}
              title={t('areaIcon.default')}
              aria-pressed={icon === null}
              onClick={() => engine.mutate('area', area.id, { icon: null })}
            >
              <span style={{ color: areaColorVar(area.color), display: 'inline-flex' }}>
                <AreaIcon size={18} />
              </span>
            </button>
            {AREA_ICONS.map((id) => (
              <button
                key={id}
                type="button"
                className="picker-item"
                aria-label={t(`areaIcon.${id}` as MessageKey)}
                title={t(`areaIcon.${id}` as MessageKey)}
                aria-pressed={icon === id}
                onClick={() => engine.mutate('area', area.id, { icon: id })}
              >
                <AreaGlyph icon={id} color={area.color} />
              </button>
            ))}
          </div>
          <div className="color-row">
            {AREA_COLORS.map((id) => (
              <button
                key={id}
                type="button"
                className="swatch"
                style={{ background: areaColorVar(id) }}
                aria-label={t(`areaColor.${id}` as MessageKey)}
                title={t(`areaColor.${id}` as MessageKey)}
                aria-pressed={color === id}
                onClick={() => engine.mutate('area', area.id, { color: id === 'gray' ? null : id })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
