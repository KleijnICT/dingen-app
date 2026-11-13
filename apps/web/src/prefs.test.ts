import { describe, expect, it } from 'vitest'
import { bannerClosedOn } from './prefs.js'

describe('bannerClosedOn', () => {
  it('hides a banner closed today', () => {
    expect(bannerClosedOn('weekly:2026-11-13', 'weekly', '2026-11-13')).toBe(true)
  })
  it('shows it again the next day', () => {
    expect(bannerClosedOn('weekly:2026-11-13', 'weekly', '2026-11-14')).toBe(false)
  })
  it('keeps kinds apart', () => {
    expect(bannerClosedOn('weekly:2026-11-13', 'monthly', '2026-11-13')).toBe(false)
  })
})
