import { describe, expect, it } from 'vitest'
import { newTag } from './factories.js'
import { normalizeTagTitle, sameTagTitle } from './tags.js'

describe('normalizeTagTitle', () => {
  it('lowercases capitals', () => {
    expect(normalizeTagTitle('Boodschappen')).toBe('boodschappen')
    expect(normalizeTagTitle('WERK')).toBe('werk')
  })

  it('trims and collapses inner whitespace', () => {
    expect(normalizeTagTitle('  15   Min \t')).toBe('15 min')
    expect(normalizeTagTitle('a  b')).toBe('a b')
  })

  it('lowercases Dutch words and accents', () => {
    expect(normalizeTagTitle('IJs')).toBe('ijs')
    expect(normalizeTagTitle('IJSSELMEER')).toBe('ijsselmeer')
    expect(normalizeTagTitle('Één')).toBe('één')
    expect(normalizeTagTitle('CAFÉ')).toBe('café')
  })

  it('leaves emoji and lowercase text alone', () => {
    expect(normalizeTagTitle('🛒 Boodschappen')).toBe('🛒 boodschappen')
    expect(normalizeTagTitle('🔥')).toBe('🔥')
    expect(normalizeTagTitle('al klein')).toBe('al klein')
  })

  it('is idempotent', () => {
    const once = normalizeTagTitle('  Mijn   Tag ')
    expect(normalizeTagTitle(once)).toBe(once)
  })
})

describe('sameTagTitle', () => {
  it('ignores case and spacing', () => {
    expect(sameTagTitle('Werk', ' werk ')).toBe(true)
    expect(sameTagTitle('15 Min', '15  min')).toBe(true)
    expect(sameTagTitle('werk', 'werken')).toBe(false)
  })
})

describe('newTag', () => {
  it('normalizes the title', () => {
    expect(newTag({ title: '  Bellen ' }).title).toBe('bellen')
  })
})
