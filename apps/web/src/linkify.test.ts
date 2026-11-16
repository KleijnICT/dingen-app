import { describe, expect, it } from 'vitest'
import { hasLinks, tokenizeLinks } from './linkify'

const links = (s: string) => tokenizeLinks(s).flatMap((t) => (t.type === 'link' ? [t.text] : []))

describe('tokenizeLinks', () => {
  it('returns plain text as one token', () => {
    expect(tokenizeLinks('just words')).toEqual([{ type: 'text', text: 'just words' }])
    expect(tokenizeLinks('')).toEqual([])
  })

  it('finds http and https links', () => {
    expect(tokenizeLinks('see https://example.com/a?b=1 now')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', text: ' now' },
    ])
    expect(links('http://a.nl')).toEqual(['http://a.nl'])
  })

  it('gives bare www links an https href and keeps the text', () => {
    expect(tokenizeLinks('www.example.com')).toEqual([
      { type: 'link', text: 'www.example.com', href: 'https://www.example.com' },
    ])
  })

  it('leaves trailing punctuation out of the link', () => {
    expect(links('Go to https://example.com.')).toEqual(['https://example.com'])
    expect(links('a https://example.com, b')).toEqual(['https://example.com'])
    expect(links('really? https://example.com/x?!')).toEqual(['https://example.com/x'])
    expect(links('(https://example.com)')).toEqual(['https://example.com'])
  })

  it('keeps balanced parentheses', () => {
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ])
    expect(links('(see https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ])
  })

  it('finds several links and keeps line breaks', () => {
    const text = 'a https://one.nl\nb www.two.nl\n\nc'
    expect(links(text)).toEqual(['https://one.nl', 'www.two.nl'])
    expect(
      tokenizeLinks(text)
        .map((t) => t.text)
        .join(''),
    ).toBe(text)
  })

  it('ignores other schemes and incomplete links', () => {
    expect(hasLinks('javascript:alert(1)')).toBe(false)
    expect(hasLinks('ftp://example.com')).toBe(false)
    expect(hasLinks('data:text/html,<b>x</b>')).toBe(false)
    expect(hasLinks('https://')).toBe(false)
    expect(hasLinks('www.')).toBe(false)
    expect(hasLinks('awww.example.com')).toBe(false)
  })

  it('does not treat markup as anything but text', () => {
    // Tags stay text; only the address inside is a link, ending at the quote.
    expect(tokenizeLinks('<b>https://x.nl</b>')).toEqual([
      { type: 'text', text: '<b>' },
      { type: 'link', text: 'https://x.nl', href: 'https://x.nl' },
      { type: 'text', text: '</b>' },
    ])
    expect(hasLinks('<script>alert(1)</script>')).toBe(false)
  })
})
