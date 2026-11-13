import { describe, expect, it } from 'vitest'
import { mergeCursor, parseCursorParam } from './protocol.js'

describe('sync protocol 2 cursor', () => {
  it('reads a cursor per space, or a protocol 1 number, and refuses anything else', () => {
    expect(parseCursorParam('{}')).toEqual({})
    expect(parseCursorParam('{"S1":3,"S2":0}')).toEqual({ S1: 3, S2: 0 })
    expect(parseCursorParam('12')).toBe(12)
    for (const bad of ['', 'x', '-1', '1.5', '[1]', 'null', '{"S":-1}', '{"S":"1"}', '{"":1}']) {
      expect(parseCursorParam(bad), bad).toBeNull()
    }
  })

  it('merges cursors keeping the highest seq per space', () => {
    expect(mergeCursor({ A: 5, B: 2 }, { B: 7, C: 1 })).toEqual({ A: 5, B: 7, C: 1 })
    expect(mergeCursor({ A: 5 }, { A: 3 })).toEqual({ A: 5 })
    expect(mergeCursor({ A: 5 }, undefined)).toEqual({ A: 5 })
  })
})
