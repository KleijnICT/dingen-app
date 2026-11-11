import { describe, expect, it } from 'vitest'
import { inviteFromSearch, inviteLink, withoutInvite } from './invite.js'

describe('invitation links', () => {
  it('reads the secret from the query string', () => {
    expect(inviteFromSearch('?invite=abc_DEF-123')).toBe('abc_DEF-123')
    expect(inviteFromSearch('?x=1&invite=abc')).toBe('abc')
    expect(inviteFromSearch('')).toBeNull()
    expect(inviteFromSearch('?invite=')).toBeNull()
  })

  it('removes only the invitation from the URL', () => {
    expect(withoutInvite('https://example.com/?invite=abc')).toBe('/')
    expect(withoutInvite('https://example.com/today?x=1&invite=abc#top')).toBe('/today?x=1#top')
  })

  it('builds a link that reads back to the same secret', () => {
    const link = inviteLink('https://example.com', 'abc_DEF-123')
    expect(link).toBe('https://example.com/?invite=abc_DEF-123')
    expect(inviteFromSearch(new URL(link).search)).toBe('abc_DEF-123')
  })
})
