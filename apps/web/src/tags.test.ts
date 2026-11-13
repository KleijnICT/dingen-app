import { newTag, ordersBetween } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { tagForName } from './tags.js'

describe('tagForName', () => {
  const [b, c, d] = ordersBetween(null, null, 3) as [string, string, string]
  const werk = newTag({ title: 'werk', order: b })
  const old = { ...newTag({ title: 'x', order: c }), title: 'Thuis' }
  const gone = { ...newTag({ title: 'weg', order: d }), deleted: true }
  const tags = [werk, old, gone]

  it('creates a new tag with a lowercase name at the end', () => {
    const found = tagForName(tags, '  Boodschappen ')
    expect(found?.created).toBe(true)
    expect(found?.tag.title).toBe('boodschappen')
    expect(found && found.tag.order > d).toBe(true)
    expect(tagForName(tags, 'IJs Halen')?.tag.title).toBe('ijs halen')
  })

  it('finds an existing tag whatever the case', () => {
    expect(tagForName(tags, 'WERK')).toEqual({ tag: werk, created: false })
    // An older tag with capitals still matches.
    expect(tagForName(tags, 'thuis')).toEqual({ tag: old, created: false })
  })

  it('does not reuse a deleted tag and ignores blank input', () => {
    expect(tagForName(tags, 'Weg')?.created).toBe(true)
    expect(tagForName(tags, '   ')).toBeNull()
  })
})
