import { type Agent, type AgentGrant, newTask, type Project } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import {
  agentsForTask,
  inheritedLevel,
  levelsFrom,
  parseScopeKey,
  placeOfTask,
  scopeKey,
  sortGrants,
  withGrant,
} from './agents.js'

const projects = new Map<string, Project>([
  ['p1', { id: 'p1', areaId: 'a1' } as Project],
  ['p2', { id: 'p2', areaId: null } as Project],
])

const agent = (id: string, grants: AgentGrant[]): Agent => ({
  id,
  name: id,
  icon: 'bot',
  color: 'gray',
  createdAt: '2026-11-12T00:00:00Z',
  lastUsedAt: null,
  tokenPrefix: null,
  grants,
})

describe('withGrant', () => {
  const grants: AgentGrant[] = [
    { scope: 'inbox', level: 'read' },
    { scope: 'area', id: 'a1', level: 'edit' },
  ]
  it('adds a grant for a new scope', () => {
    expect(withGrant(grants, { scope: 'project', id: 'p2' }, 'manage')).toEqual([
      ...grants,
      { scope: 'project', id: 'p2', level: 'manage' },
    ])
  })
  it('changes the level in place', () => {
    expect(withGrant(grants, { scope: 'area', id: 'a1' }, 'read')[1]).toEqual({
      scope: 'area',
      id: 'a1',
      level: 'read',
    })
  })
  it('removes with null and leaves other scopes alone', () => {
    expect(withGrant(grants, { scope: 'area', id: 'a1' }, null)).toEqual([grants[0]])
    expect(withGrant(grants, { scope: 'area', id: 'other' }, null)).toEqual(grants)
  })
})

describe('scope keys', () => {
  it('round-trips', () => {
    for (const s of [
      { scope: 'all' },
      { scope: 'inbox' },
      { scope: 'area', id: 'a1' },
      { scope: 'project', id: 'p:1' },
    ] as const) {
      expect(parseScopeKey(scopeKey(s))).toEqual(s)
    }
    expect(parseScopeKey('nope')).toBeNull()
  })
})

describe('places and reach', () => {
  it('puts a task in its project (with area), its area, or the Inbox', () => {
    expect(placeOfTask(newTask({ title: 'x', projectId: 'p1' }), projects)).toEqual({
      kind: 'project',
      projectId: 'p1',
      areaId: 'a1',
    })
    expect(placeOfTask(newTask({ title: 'x', areaId: 'a2' }), projects)).toEqual({
      kind: 'area',
      areaId: 'a2',
    })
    expect(placeOfTask(newTask({ title: 'x' }), projects)).toEqual({ kind: 'inbox' })
  })

  it('offers only agents that can reach the task', () => {
    const agents = [
      agent('all', [{ scope: 'all', level: 'read' }]),
      agent('area', [{ scope: 'area', id: 'a1', level: 'edit' }]),
      agent('inbox', [{ scope: 'inbox', level: 'edit' }]),
    ]
    const inProject = newTask({ title: 'x', projectId: 'p1' })
    expect(agentsForTask(agents, inProject, projects).map((a) => a.id)).toEqual(['all', 'area'])
    const loose = newTask({ title: 'x' })
    expect(agentsForTask(agents, loose, projects).map((a) => a.id)).toEqual(['all', 'inbox'])
  })

  it('finds the level kept through other grants', () => {
    const grants: AgentGrant[] = [
      { scope: 'area', id: 'a1', level: 'edit' },
      { scope: 'project', id: 'p1', level: 'manage' },
    ]
    const place = { kind: 'project', projectId: 'p1', areaId: 'a1' } as const
    expect(inheritedLevel(grants, { scope: 'project', id: 'p1' }, place)).toBe('edit')
    expect(inheritedLevel(grants, { scope: 'area', id: 'a1' }, place)).toBe('manage')
    expect(inheritedLevel([], { scope: 'project', id: 'p1' }, place)).toBeNull()
  })
})

describe('display helpers', () => {
  it('offers levels from a floor', () => {
    expect(levelsFrom(null)).toEqual(['read', 'edit', 'manage'])
    expect(levelsFrom('edit')).toEqual(['edit', 'manage'])
  })
  it('sorts Everything and Inbox first', () => {
    const sorted = sortGrants([
      { scope: 'project', id: 'p', level: 'read' },
      { scope: 'inbox', level: 'read' },
      { scope: 'all', level: 'read' },
    ])
    expect(sorted.map((g) => g.scope)).toEqual(['all', 'inbox', 'project'])
  })
})
