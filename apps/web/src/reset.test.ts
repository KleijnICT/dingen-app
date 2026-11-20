import { describe, expect, it } from 'vitest'
import { resetFromSearch, resetLink, withoutReset } from './reset.js'

describe('reset links', () => {
  it('reads the secret from the query string', () => {
    expect(resetFromSearch('?reset=abc_DEF-123')).toBe('abc_DEF-123')
    expect(resetFromSearch('?x=1&reset=abc')).toBe('abc')
    expect(resetFromSearch('')).toBeNull()
    expect(resetFromSearch('?reset=')).toBeNull()
  })

  it('removes only the secret from the URL', () => {
    expect(withoutReset('https://example.com/?reset=abc')).toBe('/')
    expect(withoutReset('https://example.com/today?x=1&reset=abc#top')).toBe('/today?x=1#top')
  })

  it('builds a link that reads back to the same secret', () => {
    const link = resetLink('https://example.com', 'abc_DEF-123')
    expect(link).toBe('https://example.com/?reset=abc_DEF-123')
    expect(resetFromSearch(new URL(link).search)).toBe('abc_DEF-123')
  })
})
