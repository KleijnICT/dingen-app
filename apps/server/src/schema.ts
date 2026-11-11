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

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  /** Beheerder van deze installatie: mag uitnodigingen maken. Het eerste account. */
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
})

/** Browsersessies. `id` is de sha256 van het cookie-token. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/** API-tokens voor clients en Claude. Alleen de hash wordt bewaard. */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
)

/**
 * Agenda's die een gebruiker volgt (alleen lezen). De URL is geheim: hij gaat
 * na het toevoegen nooit meer naar een client en komt niet in logs.
 */
export const calendars = sqliteTable(
  'calendars',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    /** Nu altijd 'ics'; ruimte voor 'caldav'. */
    kind: text('kind').notNull().default('ics'),
    url: text('url').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('calendars_user_idx').on(t.userId)],
)

// --- herinneringen ---

/**
 * Web-push-abonnementen: één per browser (apparaat). Het endpoint is uniek;
 * meldt een ander account zich op hetzelfde apparaat aan, dan neemt dat het over.
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
)

/**
 * Verstuurde herinneringen. `moment` is het tijdstip (ISO) waarop hij afging;
 * een verzette herinnering heeft een nieuw moment en gaat dus opnieuw uit.
 */
export const reminderDeliveries = sqliteTable(
  'reminder_deliveries',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    moment: text('moment').notNull(),
    sentAt: text('sent_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.taskId, t.moment] })],
)

/**
 * Uitnodigingen om een account te maken (DINGEN_REGISTRATION=invite). Eenmalig
 * bruikbaar; alleen de sha256 van het geheim wordt bewaard.
 */
export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
    usedAt: text('used_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('invitations_created_by_idx').on(t.createdBy)],
)
