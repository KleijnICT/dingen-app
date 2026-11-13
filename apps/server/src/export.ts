import {
  type EntityType,
  entitySchemas,
  normalizeTagTitle,
  type SpaceKind,
  TIMESTAMP_PATTERN,
} from '@dingen/core'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db.js'
import { entities, spaces } from './schema.js'
import type { ImportRecord, ImportSpace } from './sync.js'

export const EXPORT_FORMAT = 'dingen-export'
/**
 * Version 2 (plan 23, part 5): a `spaces` list and a `spaceId` on every
 * record. Version 1 files (one personal space, no `spaceId`) still import.
 */
export const EXPORT_VERSION = 2

/** Volgorde waarin soorten in het bestand staan: eerst de containers, dan de inhoud. */
export const EXPORT_TYPES = ['area', 'project', 'heading', 'task', 'checklistItem', 'tag'] as const

export interface ExportRecord {
  id: string
  /** The space the entity lives in; one of the file's `spaces`. */
  spaceId: string
  data: Record<string, unknown>
  fieldTs: Record<string, string>
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: number
  appVersion: string
  exportedAt: string
  /** The spaces the user owns, personal first. */
  spaces: { id: string; kind: SpaceKind }[]
  entities: Record<EntityType, ExportRecord[]>
}

/**
 * All live (not deleted) entities in the spaces the user owns (plan 23):
 * their personal space and the shared spaces they made, not spaces where
 * they are only a member.
 */
export function buildExport(
  db: Db,
  userId: string,
  appVersion: string,
  now = new Date(),
): ExportFile {
  const owned = db
    .select({ id: spaces.id, kind: spaces.kind })
    .from(spaces)
    .where(eq(spaces.ownerId, userId))
    .orderBy(asc(spaces.id))
    .all()
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'personal' ? -1 : 1))
  const rows = db
    .select()
    .from(entities)
    .where(
      and(
        inArray(
          entities.spaceId,
          owned.map((s) => s.id),
        ),
        eq(entities.deleted, false),
      ),
    )
    .all()
  const byType: Record<EntityType, ExportRecord[]> = {
    area: [],
    project: [],
    heading: [],
    task: [],
    review: [],
    checklistItem: [],
    tag: [],
  }
  for (const row of rows) {
    byType[row.entityType as EntityType]?.push({
      id: row.id,
      spaceId: row.spaceId,
      data: row.data,
      fieldTs: row.fieldTs,
    })
  }
  for (const list of Object.values(byType)) list.sort((a, b) => (a.id < b.id ? -1 : 1))
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    spaces: owned,
    entities: byType,
  }
}

const RecordShape = z.object({
  id: z.string(),
  /** Version 2; a record without it is placed as in a version 1 file. */
  spaceId: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()),
  fieldTs: z.record(z.string(), z.string().regex(TIMESTAMP_PATTERN)),
})

const Entities = z.object({
  area: z.array(RecordShape).default([]),
  project: z.array(RecordShape).default([]),
  heading: z.array(RecordShape).default([]),
  task: z.array(RecordShape).default([]),
  checklistItem: z.array(RecordShape).default([]),
  tag: z.array(RecordShape).default([]),
  review: z.array(RecordShape).default([]),
})

const Base = {
  format: z.literal(EXPORT_FORMAT),
  appVersion: z.string().optional(),
  exportedAt: z.string().optional(),
}

const Envelope = z.discriminatedUnion('version', [
  z.object({ ...Base, version: z.literal(1), entities: Entities }),
  z.object({
    ...Base,
    version: z.literal(2),
    spaces: z.array(z.object({ id: z.string().min(1), kind: z.enum(['personal', 'shared']) })),
    entities: Entities,
  }),
])

export type ParsedExport =
  | { ok: true; records: ImportRecord[]; spaces: ImportSpace[] }
  | { ok: false; issues: string[] }

const MAX_ISSUES = 20

/** Valideert een exportbestand volledig en geeft de records, of de eerste problemen. */
export function parseExport(input: unknown): ParsedExport {
  const envelope = Envelope.safeParse(input)
  if (!envelope.success) {
    return {
      ok: false,
      issues: envelope.error.issues
        .slice(0, MAX_ISSUES)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    }
  }
  const file = envelope.data
  const fileSpaces: ImportSpace[] = file.version === 2 ? file.spaces : []
  const records: ImportRecord[] = []
  const issues: string[] = []
  const seen = new Set<string>()
  const spaceIds = new Set<string>()
  for (const [index, space] of fileSpaces.entries()) {
    if (spaceIds.has(space.id)) issues.push(`spaces[${index}]: dubbel id ${space.id}`)
    spaceIds.add(space.id)
  }
  if (fileSpaces.filter((s) => s.kind === 'personal').length > 1) {
    issues.push('spaces: meer dan één persoonlijke ruimte')
  }
  for (const type of EXPORT_TYPES) {
    for (const [index, rec] of file.entities[type].entries()) {
      const where = `${type}[${index}]`
      if (rec.spaceId !== undefined && !spaceIds.has(rec.spaceId)) {
        issues.push(`${where}: onbekende ruimte ${rec.spaceId}`)
      }
      const key = `${type}:${rec.id}`
      if (seen.has(key)) issues.push(`${where}: dubbel id ${rec.id}`)
      seen.add(key)
      if (rec.data.id !== rec.id) issues.push(`${where}: data.id wijkt af van id`)
      const parsed = entitySchemas[type].strict().safeParse(rec.data)
      if (!parsed.success) {
        for (const i of parsed.error.issues) {
          issues.push(`${where}.${i.path.join('.') || '(root)'}: ${i.message}`)
        }
      }
      for (const field of Object.keys(rec.data)) {
        if (field !== 'id' && !rec.fieldTs[field])
          issues.push(`${where}: tijdstempel voor ${field} ontbreekt`)
      }
      // Tag names are lowercase (plan 23); older files may have capitals.
      const data =
        type === 'tag' && typeof rec.data.title === 'string'
          ? { ...rec.data, title: normalizeTagTitle(rec.data.title) }
          : rec.data
      const record: ImportRecord = { entityType: type, id: rec.id, data, fieldTs: rec.fieldTs }
      if (rec.spaceId !== undefined) record.spaceId = rec.spaceId
      records.push(record)
    }
  }
  if (issues.length > 0) return { ok: false, issues: issues.slice(0, MAX_ISSUES) }
  return { ok: true, records, spaces: fileSpaces }
}
