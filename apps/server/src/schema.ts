import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Metadata over de installatie zelf. Eén rij per sleutel. */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** Het sync-log: elke ontvangen wijziging, in volgorde van ontvangst. */
export const changes = sqliteTable(
  'changes',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    clientId: text('client_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    fields: text('fields', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    ts: text('ts').notNull(),
    receivedAt: text('received_at').notNull(),
  },
  (t) => [
    uniqueIndex('changes_user_change_idx').on(t.userId, t.id),
    index('changes_user_seq_idx').on(t.userId, t.seq),
  ],
)

/** De gematerialiseerde staat per entiteit, zodat de API niet het log hoeft af te spelen. */
export const entities = sqliteTable(
  'entities',
  {
    userId: text('user_id').notNull(),
    entityType: text('entity_type').notNull(),
    id: text('id').notNull(),
    data: text('data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    fieldTs: text('field_ts', { mode: 'json' }).notNull().$type<Record<string, string>>(),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
    updatedSeq: integer('updated_seq').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.entityType, t.id] })],
)
