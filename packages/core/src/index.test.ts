import { describe, expect, it } from 'vitest'
import { APP_NAME } from './index.js'

describe('core', () => {
  it('kent de naam van de app', () => {
    expect(APP_NAME).toBe('Dingen')
  })
})
