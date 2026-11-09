import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Metadata over de installatie zelf. Eén rij per sleutel. */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
