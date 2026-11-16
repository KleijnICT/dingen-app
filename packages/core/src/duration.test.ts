import { describe, expect, it } from 'vitest'
import { fitsDuration, formatDuration, totalDuration } from './duration.js'

describe('duration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(15)).toBe('15m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90, 'u')).toBe('1u30')
    expect(formatDuration(125)).toBe('2h05')
  })

  it('totals, counting no duration as 0', () => {
    expect(totalDuration([{ duration: 15 }, { duration: null }, { duration: 30 }])).toBe(45)
  })

  it('filters on at most n minutes', () => {
    expect(fitsDuration({ duration: 15 }, 15)).toBe(true)
    expect(fitsDuration({ duration: 30 }, 15)).toBe(false)
    expect(fitsDuration({ duration: null }, 15)).toBe(false)
    expect(fitsDuration({ duration: null }, null)).toBe(true)
  })
})
