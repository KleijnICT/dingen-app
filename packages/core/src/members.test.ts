import { describe, expect, it } from 'vitest'
import { allows, levelFor, parseMemberId } from './members.js'

describe('levelFor', () => {
  const inbox = { kind: 'inbox' } as const
  const area = { kind: 'area', areaId: 'a1' } as const
  const project = { kind: 'project', projectId: 'p1', areaId: 'a1' } as const
  const loose = { kind: 'project', projectId: 'p2', areaId: null } as const

  it('gives the owner everything', () => {
    expect(levelFor(null, project)).toBe('manage')
  })

  it('lets `all` reach everywhere at its level', () => {
    expect(levelFor([{ scope: 'all', level: 'read' }], loose)).toBe('read')
    expect(levelFor([{ scope: 'all', level: 'edit' }], inbox)).toBe('edit')
  })

  it('lets an area grant reach the area and its projects only', () => {
    const grants = [{ scope: 'area', id: 'a1', level: 'edit' }] as const
    expect(levelFor(grants, area)).toBe('edit')
    expect(levelFor(grants, project)).toBe('edit')
    expect(levelFor(grants, loose)).toBeNull()
    expect(levelFor(grants, inbox)).toBeNull()
  })

  it('takes the highest of several grants', () => {
    const grants = [
      { scope: 'area', id: 'a1', level: 'read' },
      { scope: 'project', id: 'p1', level: 'manage' },
      { scope: 'inbox', level: 'edit' },
    ] as const
    expect(levelFor(grants, project)).toBe('manage')
    expect(levelFor(grants, area)).toBe('read')
    expect(levelFor(grants, inbox)).toBe('edit')
  })

  it('compares levels', () => {
    expect(allows('manage', 'edit')).toBe(true)
    expect(allows('read', 'edit')).toBe(false)
    expect(allows(null, 'read')).toBe(false)
  })
})

describe('parseMemberId', () => {
  it('splits kind and id', () => {
    expect(parseMemberId('agent:x1')).toEqual({ kind: 'agent', id: 'x1' })
    expect(parseMemberId('nope')).toBeNull()
  })
})
