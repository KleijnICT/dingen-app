import { describe, expect, it } from 'vitest'
import { en } from './en.js'
import { getLocale, LOCALES, setLocaleChoice, t } from './index.js'
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

  it('uses English on request and fills parameters', () => {
    setLocaleChoice('en')
    expect(getLocale()).toBe('en')
    expect(t('account.tokens.reveal', { name: 'Claude' })).toContain('Token for Claude')
    setLocaleChoice('system')
  })

  it('falls back to English for a system language it does not know', () => {
    setLocaleChoice('system')
    expect(['en', 'nl']).toContain(getLocale())
  })

  it('switches to Dutch on request', () => {
    setLocaleChoice('nl')
    expect(t('list.today')).toBe('Vandaag')
    setLocaleChoice('system')
  })
})
