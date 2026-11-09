import { describe, expect, it } from 'vitest'
import { type Change, validateChangeFields } from './entities.js'
import { newTask } from './factories.js'
import { createClock } from './hlc.js'
import { ulid } from './ids.js'
import { applyChange, applyChanges, isDeleted, recordKey } from './sync.js'

const clockA = createClock('A', () => 2000)
const clockB = createClock('B', () => 1000)

function change(partial: Partial<Change> & Pick<Change, 'entityId' | 'fields' | 'ts'>): Change {
  return { id: ulid(), entityType: 'task', clientId: 'A', ...partial }
}

describe('applyChange', () => {
  it('maakt een record van een complete taak', () => {
    const task = newTask({ title: 'Melk kopen' })
    const { id, ...fields } = task
    const rec = applyChange(undefined, change({ entityId: id, fields, ts: clockA.now() }))
    expect(rec.data).toEqual(task)
    expect(Object.keys(rec.fieldTs)).toEqual(Object.keys(fields))
  })

  it('laat per veld de hoogste tijdstempel winnen', () => {
    const task = newTask({ title: 'Oud', notes: 'oud' })
    const { id, ...fields } = task
    const tsOld = clockB.now()
    const tsNew = clockA.now()
    let rec = applyChange(undefined, change({ entityId: id, fields, ts: tsOld }))
    rec = applyChange(rec, change({ entityId: id, fields: { title: 'Nieuw' }, ts: tsNew }))
    // Een late, oudere wijziging op title mag niet winnen; op notes wel (daar was de stempel ouder).
    rec = applyChange(
      rec,
      change({ entityId: id, fields: { title: 'Verlaat', notes: 'nieuw' }, ts: clockB.now() }),
    )
    expect(rec.data.title).toBe('Nieuw')
    expect(rec.data.notes).toBe('nieuw')
  })

  it('voegt gelijktijdige wijzigingen op verschillende velden samen', () => {
    const task = newTask({ title: 'Taak' })
    const { id, ...fields } = task
    let rec = applyChange(undefined, change({ entityId: id, fields, ts: clockB.now() }))
    const phone = change({
      entityId: id,
      fields: { status: 'completed' },
      ts: clockA.now(),
      clientId: 'A',
    })
    const laptop = change({
      entityId: id,
      fields: { notes: 'Bij AH' },
      ts: clockB.now(),
      clientId: 'B',
    })
    rec = applyChange(rec, phone)
    rec = applyChange(rec, laptop)
    expect(rec.data.status).toBe('completed')
    expect(rec.data.notes).toBe('Bij AH')
  })

  it('is idempotent en volgorde-onafhankelijk', () => {
    const task = newTask({ title: 'Taak' })
    const { id, ...fields } = task
    const c1 = change({ entityId: id, fields, ts: clockB.now() })
    const c2 = change({ entityId: id, fields: { title: 'B' }, ts: clockA.now() })
    const c3 = change({ entityId: id, fields: { title: 'C' }, ts: clockB.now() })
    const key = recordKey('task', id)
    const forward = applyChanges(new Map(), [c1, c2, c3]).get(key)
    const backward = applyChanges(new Map(), [c3, c2, c1, c1, c2]).get(key)
    expect(forward?.data).toEqual(backward?.data)
    expect(forward?.data.title).toBe('B')
  })

  it('verwijdert via tombstone', () => {
    const task = newTask({ title: 'Weg' })
    const { id, ...fields } = task
    let rec = applyChange(undefined, change({ entityId: id, fields, ts: clockB.now() }))
    expect(isDeleted(rec)).toBe(false)
    rec = applyChange(rec, change({ entityId: id, fields: { deleted: true }, ts: clockA.now() }))
    expect(isDeleted(rec)).toBe(true)
  })
})

describe('validateChangeFields', () => {
  it('eist een complete entiteit als die nog niet bestaat', () => {
    const c = change({ entityId: ulid(), fields: { title: 'Alleen titel' }, ts: clockA.now() })
    const result = validateChangeFields(c, undefined)
    expect(result.ok).toBe(false)
  })

  it('accepteert een complete nieuwe taak en daarna een partiële wijziging', () => {
    const task = newTask({ title: 'Compleet' })
    const { id, ...fields } = task
    const create = change({ entityId: id, fields, ts: clockA.now() })
    expect(validateChangeFields(create, undefined)).toEqual({ ok: true })
    const edit = change({
      entityId: id,
      fields: { when: { kind: 'date', date: '2026-11-10' } },
      ts: clockA.now(),
    })
    expect(validateChangeFields(edit, task)).toEqual({ ok: true })
  })

  it('weigert onbekende velden en foute waarden', () => {
    const task = newTask({ title: 'Compleet' })
    const bad = change({ entityId: task.id, fields: { kleur: 'rood' }, ts: clockA.now() })
    expect(validateChangeFields(bad, task).ok).toBe(false)
    const badStatus = change({ entityId: task.id, fields: { status: 'klaar' }, ts: clockA.now() })
    expect(validateChangeFields(badStatus, task).ok).toBe(false)
  })
})
