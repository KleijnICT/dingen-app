import { describe, expect, it } from 'vitest'
import { en } from './en.js'
import { DEFAULT_LOCALE, getLocale, LOCALES, setLocale, t } from './index.js'
import { nl } from './nl.js'

describe('i18n', () => {
  it('every locale has exactly the English keys', () => {
    expect(Object.keys(nl).sort()).toEqual(Object.keys(en).sort())
    for (const locale of Object.values(LOCALES)) {
      for (const [key, value] of Object.entries(locale.messages)) {
        expect(value, key).not.toBe('')
      }
    }
  })

  it('starts in English regardless of the browser language', () => {
    expect(DEFAULT_LOCALE).toBe('en')
    expect(getLocale()).toBe('en')
    expect(t('account.tokens.reveal', { name: 'Claude' })).toContain('Token for Claude')
  })

  it('switches to Dutch on request and back', () => {
    setLocale('nl')
    expect(t('list.today')).toBe('Vandaag')
    setLocale('en')
    expect(t('list.today')).toBe('Today')
  })
})
