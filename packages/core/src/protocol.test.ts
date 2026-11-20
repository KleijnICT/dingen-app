import { describe, expect, it } from 'vitest'
import {
  CLIENT_OUTDATED,
  ClientOutdatedBodySchema,
  clientOutdatedBody,
  MIN_CLIENT_PROTOCOL,
  mergeCursor,
  parseCursorParam,
  requestProtocol,
  SYNC_PROTOCOL,
} from './protocol.js'

describe('sync protocol', () => {
  it('is 4 and accepts nothing older', () => {
    expect(SYNC_PROTOCOL).toBe(4)
    expect(MIN_CLIENT_PROTOCOL).toBe(4)
  })

  it('reads the protocol a request names, 0 when it names none', () => {
    expect(requestProtocol('4')).toBe(4)
    expect(requestProtocol('3')).toBe(3)
    expect(requestProtocol(undefined)).toBe(0)
    expect(requestProtocol(null)).toBe(0)
    expect(requestProtocol('')).toBe(0)
    expect(requestProtocol('nonsense')).toBe(0)
    expect(requestProtocol('-1')).toBe(0)
  })

  it('tells an outdated client what to do', () => {
    const body = clientOutdatedBody(3)
    expect(ClientOutdatedBodySchema.parse(body)).toEqual(body)
    expect(body).toMatchObject({ error: CLIENT_OUTDATED, protocol: 4, minProtocol: 4 })
    expect(body.message).toContain('protocol 3')
    expect(clientOutdatedBody(0).message).toContain('out of date')
  })
})

describe('cursor per space', () => {
  it('reads a cursor per space and refuses anything else', () => {
    expect(parseCursorParam('{}')).toEqual({})
    expect(parseCursorParam('{"S1":3,"S2":0}')).toEqual({ S1: 3, S2: 0 })
    for (const bad of [
      '',
      'x',
      '12',
      '-1',
      '1.5',
      '[1]',
      'null',
      '{"S":-1}',
      '{"S":"1"}',
      '{"":1}',
    ]) {
      expect(parseCursorParam(bad), bad).toBeNull()
    }
  })

  it('merges cursors keeping the highest seq per space', () => {
    expect(mergeCursor({ A: 5, B: 2 }, { B: 7, C: 1 })).toEqual({ A: 5, B: 7, C: 1 })
    expect(mergeCursor({ A: 5 }, { A: 3 })).toEqual({ A: 5 })
    expect(mergeCursor({ A: 5 }, undefined)).toEqual({ A: 5 })
  })
})
