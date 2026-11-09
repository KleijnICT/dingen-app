import type { Area, ChecklistItem, Heading, Project, Tag, Task } from './entities.js'
import { ulid } from './ids.js'
import { firstOrder } from './order.js'

/**
 * Makers met de standaardwaarden van Dingen. Clients gebruiken deze zodat een
 * nieuwe entiteit altijd compleet is en de server hem kan valideren.
 */

const nowIso = () => new Date().toISOString()

export function newTask(fields: Partial<Task> & { title: string }): Task {
  return {
    id: ulid(),
    createdAt: nowIso(),
    deleted: false,
    notes: '',
    status: 'open',
    projectId: null,
    headingId: null,
    areaId: null,
    when: { kind: 'inbox' },
    evening: false,
    deadline: null,
    tagIds: [],
    repeat: null,
    order: firstOrder(),
    completedAt: null,
    ...fields,
  }
}

export function newProject(fields: Partial<Project> & { title: string }): Project {
  return {
    id: ulid(),
    createdAt: nowIso(),
    deleted: false,
    notes: '',
    areaId: null,
    status: 'open',
    when: { kind: 'anytime' },
    deadline: null,
    tagIds: [],
    order: firstOrder(),
    completedAt: null,
    ...fields,
  }
}

export function newArea(fields: Partial<Area> & { title: string }): Area {
  return { id: ulid(), createdAt: nowIso(), deleted: false, order: firstOrder(), ...fields }
}

export function newHeading(
  fields: Partial<Heading> & { title: string; projectId: string },
): Heading {
  return { id: ulid(), createdAt: nowIso(), deleted: false, order: firstOrder(), ...fields }
}

export function newChecklistItem(
  fields: Partial<ChecklistItem> & { title: string; taskId: string },
): ChecklistItem {
  return {
    id: ulid(),
    createdAt: nowIso(),
    deleted: false,
    done: false,
    order: firstOrder(),
    ...fields,
  }
}

export function newTag(fields: Partial<Tag> & { title: string }): Tag {
  return {
    id: ulid(),
    createdAt: nowIso(),
    deleted: false,
    parentId: null,
    order: firstOrder(),
    ...fields,
  }
}
