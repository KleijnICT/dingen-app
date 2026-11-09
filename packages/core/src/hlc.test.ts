import { describe, expect, it } from 'vitest'
import { createClock, formatTimestamp, parseTimestamp } from './hlc.js'

describe('hlc', () => {
  it('geeft strikt oplopende stempels, ook binnen dezelfde milliseconde', () => {
    const clock = createClock('A', () => 1000)
    const a = clock.now()
    const b = clock.now()
    expect(b > a).toBe(true)
    expect(parseTimestamp(a)).toEqual({ wall: 1000, counter: 0, clientId: 'A' })
    expect(parseTimestamp(b)).toEqual({ wall: 1000, counter: 1, clientId: 'A' })
  })

  it('springt vooruit na een stempel van elders uit de toekomst', () => {
    const clock = createClock('A', () => 1000)
    clock.receive(formatTimestamp(5000, 3, 'B'))
    const t = clock.now()
    expect(parseTimestamp(t)).toEqual({ wall: 5000, counter: 5, clientId: 'A' })
  })

  it('vergelijkt als string in dezelfde volgorde als de klok', () => {
    expect(formatTimestamp(999, 10, 'A') < formatTimestamp(1000, 0, 'A')).toBe(true)
    expect(formatTimestamp(1000, 2, 'A') < formatTimestamp(1000, 10, 'A')).toBe(true)
    expect(formatTimestamp(1000, 2, 'A') < formatTimestamp(1000, 2, 'B')).toBe(true)
  })
})
