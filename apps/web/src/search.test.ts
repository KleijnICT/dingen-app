import { newArea, newProject, newTask } from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { searchWorkspace } from './search.js'

const area = newArea({ title: 'Huis' })
const project = newProject({ title: 'Keuken verbouwen' })
const closed = newProject({ title: 'Keuken oud', status: 'completed' })
const tasks = [
  newTask({ title: 'Tegels kiezen voor keuken' }),
  newTask({ title: 'Offerte', notes: 'Aannemer voor de keuken bellen' }),
  newTask({ title: 'Café reserveren' }),
  newTask({ title: 'Keuken opruimen', status: 'completed' }),
]
const source = { tasks, projects: [project, closed], areas: [area] }

describe('searchWorkspace', () => {
  it('finds titles before notes and skips finished items', () => {
    const hits = searchWorkspace(source, 'KEUKEN')
    expect(hits.map((h) => h.item.title)).toEqual([
      'Keuken verbouwen',
      'Tegels kiezen voor keuken',
      'Offerte',
    ])
  })

  it('needs every word and ignores accents', () => {
    expect(searchWorkspace(source, 'keuken tegels').map((h) => h.item.title)).toEqual([
      'Tegels kiezen voor keuken',
    ])
    expect(searchWorkspace(source, 'cafe').map((h) => h.kind)).toEqual(['task'])
  })

  it('returns nothing for an empty query', () => {
    expect(searchWorkspace(source, '  ')).toEqual([])
  })
})
