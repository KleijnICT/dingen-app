import { type EntityType, entitySchemas, TIMESTAMP_PATTERN } from '@dingen/core'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db.js'
import { entities } from './schema.js'
import type { ImportRecord } from './sync.js'

export const EXPORT_FORMAT = 'dingen-export'
export const EXPORT_VERSION = 1

/** Volgorde waarin soorten in het bestand staan: eerst de containers, dan de inhoud. */
export const EXPORT_TYPES = ['area', 'project', 'heading', 'task', 'checklistItem', 'tag'] as const

export interface ExportRecord {
  id: string
  data: Record<string, unknown>
  fieldTs: Record<string, string>
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: number
  appVersion: string
  exportedAt: string
  entities: Record<EntityType, ExportRecord[]>
}

/** Alle levende (niet-verwijderde) entiteiten van een gebruiker. */
export function buildExport(
  db: Db,
  userId: string,
  appVersion: string,
  now = new Date(),
): ExportFile {
  const rows = db
    .select()
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.deleted, false)))
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
    byType[row.entityType as EntityType]?.push({ id: row.id, data: row.data, fieldTs: row.fieldTs })
  }
  for (const list of Object.values(byType)) list.sort((a, b) => (a.id < b.id ? -1 : 1))
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    entities: byType,
  }
}

const RecordShape = z.object({
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
  fieldTs: z.record(z.string(), z.string().regex(TIMESTAMP_PATTERN)),
})

const Envelope = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  appVersion: z.string().optional(),
  exportedAt: z.string().optional(),
  entities: z.object({
    area: z.array(RecordShape).default([]),
    project: z.array(RecordShape).default([]),
    heading: z.array(RecordShape).default([]),
    task: z.array(RecordShape).default([]),
    checklistItem: z.array(RecordShape).default([]),
    tag: z.array(RecordShape).default([]),
    review: z.array(RecordShape).default([]),
  }),
})

export type ParsedExport = { ok: true; records: ImportRecord[] } | { ok: false; issues: string[] }

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
  const records: ImportRecord[] = []
  const issues: string[] = []
  const seen = new Set<string>()
  for (const type of EXPORT_TYPES) {
    for (const [index, rec] of envelope.data.entities[type].entries()) {
      const where = `${type}[${index}]`
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
      records.push({ entityType: type, id: rec.id, data: rec.data, fieldTs: rec.fieldTs })
    }
  }
  if (issues.length > 0) return { ok: false, issues: issues.slice(0, MAX_ISSUES) }
  return { ok: true, records }
}
