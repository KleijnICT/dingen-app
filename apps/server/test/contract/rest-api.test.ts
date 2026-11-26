import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ACTIVITY_KINDS,
  AGENT_LEVELS,
  AREA_COLORS,
  AREA_ICONS,
  type Change,
  createClock,
  EntityType,
  newArea,
  newTask,
  ulid,
} from '@dingen/core'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FOLD_GAP_MS, FOLD_SPAN_MS } from '../../src/activity/derive.js'
import { DEFAULT_LIMIT, MAX_LIMIT, SCAN_BUDGET } from '../../src/activity/service.js'
import { createApp } from '../../src/app.js'
import { INVITATION_TTL_MS } from '../../src/auth/invitations.js'
import {
  RESET_ADMIN_TTL_MS,
  RESET_MAIL_TTL_MS,
  RESET_PER_ADDRESS,
  RESET_PER_CLIENT,
} from '../../src/auth/reset.js'
import { RECOVERY_CODE_COUNT, totpCode, totpStep } from '../../src/auth/totp.js'
import { CHALLENGE_TTL_MS } from '../../src/auth/two-step.js'
import { FeedError } from '../../src/calendar/ics.js'
import { MAX_RANGE_DAYS, REFRESH_MS, RETRY_MS } from '../../src/calendar/service.js'
import { migrationsFolder, openDatabase } from '../../src/db.js'
import { EXPORT_FORMAT, EXPORT_TYPES, EXPORT_VERSION } from '../../src/export.js'
import { MailService } from '../../src/mail/service.js'
import { PushService } from '../../src/push/service.js'
import { ActivityQuery } from '../../src/routes/activity.js'
import { DeleteBody, RegistrationBody, UserPatch } from '../../src/routes/admin.js'
import { TestMail } from '../../src/routes/admin-security.js'
import { AccessQuery, AgentBody, AgentPatch } from '../../src/routes/agents.js'
import {
  Code,
  Forgot,
  NewPassword,
  Registration,
  Reset,
  TodaySeen,
  TwoStepOff,
} from '../../src/routes/auth.js'
import { AddBody, PatchBody, RangeQuery } from '../../src/routes/calendars.js'
import { MAX_IMPORT_BYTES } from '../../src/routes/data.js'

/**
 * The contract of the REST endpoints native clients use besides sync
 * (spec/api.md), pinned.
 *
 * `rest-api.json` next to this file lists every endpoint of spec/api.md with
 * who may call it, its request (the server's own zod schemas, as JSON Schema),
 * its answers (the strict schemas below) and its errors. The tests then call
 * every endpoint on a real app and check each answer against its schema with
 * no extra or missing field, each error against the list, and each `auth`
 * against the server's guards. Every listed answer and error must be seen at
 * least once, except the few in `NOT_EXERCISED`.
 *
 * Same rule as the sync contract: from 1.0.0-beta.1 until 2.0 only additive
 * changes (a new optional field in an answer, a new endpoint, a looser
 * check). After such a change: run `pnpm --filter @dingen/server test -u`,
 * check that the diff of rest-api.json only adds, update spec/api.md, and
 * commit them with the change.
 */

// --- answer shapes ---

const Iso = z.iso.datetime()
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Ok = z.strictObject({ ok: z.literal(true) })
/** Every error: a code, sometimes with zod `issues`, a `detail` or a `message`. */
const ErrorBody = z.strictObject({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
  detail: z.string().optional(),
  message: z.string().optional(),
})

const User = z.strictObject({
  id: z.string(),
  email: z.string(),
  createdAt: Iso,
  isAdmin: z.boolean(),
  homeAssistant: z.boolean(),
  hasPassword: z.boolean(),
  todaySeenOn: Day.nullable(),
  twoStep: z.boolean(),
  blocked: z.boolean(),
})
const UserAnswer = z.strictObject({ user: User })

const Status = z.strictObject({
  hasUsers: z.boolean(),
  registrationOpen: z.boolean(),
  registration: z.enum(['closed', 'open', 'invite']),
  passwordReset: z.literal(true).optional(),
  demo: z.literal(true).optional(),
})
const Me = z.strictObject({
  user: User,
  source: z.enum(['session', 'token']),
  member: z.string(),
  ingress: z.boolean(),
})
const Expiry = z.strictObject({ ok: z.literal(true), expiresAt: Iso })
const DemoAccounts = z.strictObject({
  accounts: z.array(
    z.strictObject({ email: z.string(), name: z.string(), description: z.string() }),
  ),
})
const TwoStepState = z.strictObject({
  enabled: z.boolean(),
  recoveryCodesLeft: z.number().int().min(0),
})
const TwoStepSetup = z.strictObject({ secret: z.string(), uri: z.string() })
const RecoveryCodes = z.strictObject({ recoveryCodes: z.array(z.string()) })

const CalendarSummary = z.strictObject({
  id: z.string(),
  name: z.string(),
  color: z.enum(AREA_COLORS).nullable(),
  areaId: z.string().nullable(),
  host: z.string(),
  createdAt: Iso,
})
const CalendarEvent = z.strictObject({
  id: z.string(),
  calendarId: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  allDay: z.boolean(),
  startDate: Day,
  endDate: Day,
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  start: Iso,
  end: Iso,
})
const CalendarEvents = z.strictObject({
  timezone: z.string(),
  calendars: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      color: z.enum(AREA_COLORS).nullable(),
      areaId: z.string().nullable(),
    }),
  ),
  events: z.array(CalendarEvent),
  failed: z.array(z.string()),
})

const Grant = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('all'), level: z.enum(AGENT_LEVELS) }),
  z.strictObject({ scope: z.literal('inbox'), level: z.enum(AGENT_LEVELS) }),
  z.strictObject({ scope: z.literal('area'), id: z.string(), level: z.enum(AGENT_LEVELS) }),
  z.strictObject({ scope: z.literal('project'), id: z.string(), level: z.enum(AGENT_LEVELS) }),
])
const Agent = z.strictObject({
  id: z.string(),
  name: z.string(),
  icon: z.enum(AREA_ICONS),
  color: z.enum(AREA_COLORS),
  createdAt: Iso,
  lastUsedAt: Iso.nullable(),
  tokenPrefix: z.string().nullable(),
  grants: z.array(Grant),
})
const AgentWithToken = z.strictObject({ agent: Agent, token: z.string().startsWith('dgn_') })
const Members = z.strictObject({
  members: z.array(
    z.strictObject({
      id: z.string(),
      kind: z.enum(['user', 'agent']),
      name: z.string(),
      icon: z.string().nullable(),
      color: z.string().nullable(),
    }),
  ),
})
const Access = z.strictObject({
  members: z.array(z.strictObject({ member: z.string(), level: z.enum(AGENT_LEVELS) })),
})
const ActivityPage = z.strictObject({
  items: z.array(
    z.strictObject({
      seq: z.number().int(),
      at: Iso,
      actor: z.string(),
      kind: z.enum(ACTIVITY_KINDS),
      entityType: z.enum(['task', 'project', 'area', 'heading']),
      entityId: z.string(),
      title: z.string(),
      container: z
        .strictObject({ type: z.enum(['project', 'area']), id: z.string(), title: z.string() })
        .nullable(),
      fields: z.array(z.strictObject({ field: z.string(), from: z.unknown(), to: z.unknown() })),
    }),
  ),
  nextBefore: z.number().int().nullable(),
})

const AdminUser = z.strictObject({
  id: z.string(),
  email: z.string(),
  createdAt: Iso,
  isAdmin: z.boolean(),
  blockedAt: Iso.nullable(),
  lastActiveAt: Iso.nullable(),
  homeAssistant: z.boolean(),
  hasPassword: z.boolean(),
  totpEnabled: z.boolean(),
})
const Backup = z.strictObject({
  name: z.string(),
  kind: z.enum(['daily', 'pre-update', 'pre-restore', 'pre-delete', 'manual']),
  at: Iso,
  schema: z.string(),
  size: z.number().int(),
})
const Invitation = z.strictObject({
  id: z.string(),
  createdAt: Iso,
  expiresAt: Iso,
  createdBy: z.string().nullable(),
  usedAt: Iso.nullable(),
  usedBy: z.string().nullable(),
  revokedAt: Iso.nullable(),
  status: z.enum(['open', 'used', 'expired', 'revoked']),
})
const ExportRecord = z.strictObject({
  id: z.string(),
  spaceId: z.string(),
  data: z.record(z.string(), z.unknown()),
  fieldTs: z.record(z.string(), z.string()),
})
const ExportFile = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  appVersion: z.string(),
  exportedAt: Iso,
  spaces: z.array(z.strictObject({ id: z.string(), kind: z.enum(['personal', 'shared']) })),
  entities: z.strictObject(
    Object.fromEntries(EXPORT_TYPES.map((t) => [t, z.array(ExportRecord)])) as Record<
      (typeof EXPORT_TYPES)[number],
      z.ZodArray<typeof ExportRecord>
    >,
  ),
})
const Counts = z.strictObject({
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
})
const ImportResult = z.strictObject({
  mode: z.enum(['merge', 'reject']),
  counts: z.strictObject(
    Object.fromEntries(EntityType.options.map((t) => [t, Counts])) as Record<
      EntityType,
      typeof Counts
    >,
  ),
  total: Counts,
  seq: z.number().int(),
})

/** Not JSON: the answer is the file itself. */
const SQLITE_FILE = 'binary: the SQLite file (content-type application/vnd.sqlite3)'

// --- the endpoints ---

/**
 * Who may call an endpoint (spec/api.md §1.2):
 * - `none`: anyone.
 * - `user`: a session or any agent token.
 * - `session`: a session; a token gets 403 `session_required`.
 * - `everything:<level>`: a session, or a token whose agent has an `all`
 *   grant of at least that level; other tokens get 403 `agent_scope`.
 * - `admin`: an administrator with a session; a token gets 403
 *   `session_required`, someone else 403 `forbidden`.
 * - `admin:everything:manage`: an administrator, with a session or a token
 *   with `all` at `manage`. `+session` makes a token get `session_required`.
 */
type Auth =
  | 'none'
  | 'user'
  | 'session'
  | 'everything:read'
  | 'everything:manage'
  | 'admin'
  | 'admin:everything:manage'
  | 'admin:everything:manage+session'

type Answer = z.ZodType | string
interface Endpoint {
  id: string
  package: 'WP1' | 'WP2' | 'WP3' | 'WP4' | 'web'
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  auth: Auth
  query?: z.ZodType
  body?: z.ZodType
  /** Status to answer shape. */
  answers: Record<number, Answer>
  /** `[status, error]` besides the ones `auth` implies. */
  errors: [number, string][]
}

const invalidBody: [number, string] = [400, 'invalid_body']
const notFound: [number, string] = [404, 'not_found']

const ENDPOINTS: Endpoint[] = [
  // WP1: review and calendars
  {
    id: 'calendars.list',
    package: 'WP1',
    method: 'GET',
    path: '/api/calendars',
    auth: 'everything:read',
    answers: { 200: z.strictObject({ calendars: z.array(CalendarSummary) }) },
    errors: [],
  },
  {
    id: 'calendars.add',
    package: 'WP1',
    method: 'POST',
    path: '/api/calendars',
    auth: 'everything:manage',
    body: AddBody,
    answers: { 201: z.strictObject({ calendar: CalendarSummary }) },
    errors: [
      invalidBody,
      [400, 'invalid_url'],
      [400, 'feed_unreachable'],
      [400, 'feed_invalid'],
      [400, 'feed_too_large'],
    ],
  },
  {
    id: 'calendars.update',
    package: 'WP1',
    method: 'PATCH',
    path: '/api/calendars/:id',
    auth: 'everything:manage',
    body: PatchBody,
    answers: { 200: z.strictObject({ calendar: CalendarSummary }) },
    errors: [invalidBody, notFound],
  },
  {
    id: 'calendars.remove',
    package: 'WP1',
    method: 'DELETE',
    path: '/api/calendars/:id',
    auth: 'everything:manage',
    answers: { 200: Ok },
    errors: [notFound],
  },
  {
    id: 'calendars.events',
    package: 'WP1',
    method: 'GET',
    path: '/api/calendars/events',
    auth: 'everything:read',
    query: RangeQuery,
    answers: { 200: CalendarEvents },
    errors: [[400, 'invalid_range']],
  },

  // WP2: account and settings
  {
    id: 'auth.me',
    package: 'WP2',
    method: 'GET',
    path: '/api/auth/me',
    auth: 'user',
    answers: { 200: Me },
    errors: [],
  },
  {
    id: 'auth.password',
    package: 'WP2',
    method: 'POST',
    path: '/api/auth/password',
    auth: 'session',
    body: NewPassword,
    answers: { 200: Ok },
    errors: [
      invalidBody,
      [400, 'password_required'],
      [401, 'invalid_credentials'],
      [429, 'too_many_attempts'],
    ],
  },
  {
    id: 'auth.twoStep',
    package: 'WP2',
    method: 'GET',
    path: '/api/auth/two-step',
    auth: 'session',
    answers: { 200: TwoStepState },
    errors: [],
  },
  {
    id: 'auth.twoStep.setup',
    package: 'WP2',
    method: 'POST',
    path: '/api/auth/two-step/setup',
    auth: 'session',
    answers: { 200: TwoStepSetup },
    errors: [[409, 'totp_already_enabled']],
  },
  {
    id: 'auth.twoStep.enable',
    package: 'WP2',
    method: 'POST',
    path: '/api/auth/two-step/enable',
    auth: 'session',
    body: Code,
    answers: { 200: RecoveryCodes },
    errors: [
      invalidBody,
      [400, 'totp_not_started'],
      [400, 'invalid_code'],
      [409, 'totp_already_enabled'],
      [429, 'too_many_attempts'],
    ],
  },
  {
    id: 'auth.twoStep.disable',
    package: 'WP2',
    method: 'POST',
    path: '/api/auth/two-step/disable',
    auth: 'session',
    body: TwoStepOff,
    answers: { 200: Ok },
    errors: [
      invalidBody,
      [401, 'invalid_credentials'],
      [401, 'invalid_code'],
      [429, 'too_many_attempts'],
    ],
  },
  {
    id: 'auth.todaySeen',
    package: 'WP2',
    method: 'POST',
    path: '/api/auth/today-seen',
    auth: 'user',
    body: TodaySeen,
    answers: { 200: Ok },
    errors: [invalidBody],
  },

  // WP3: agents, members and activity
  {
    id: 'agents.list',
    package: 'WP3',
    method: 'GET',
    path: '/api/agents',
    auth: 'session',
    answers: { 200: z.strictObject({ agents: z.array(Agent) }) },
    errors: [],
  },
  {
    id: 'agents.create',
    package: 'WP3',
    method: 'POST',
    path: '/api/agents',
    auth: 'session',
    body: AgentBody,
    answers: { 201: AgentWithToken },
    errors: [invalidBody, [400, 'invalid_grant']],
  },
  {
    id: 'agents.update',
    package: 'WP3',
    method: 'PATCH',
    path: '/api/agents/:id',
    auth: 'session',
    body: AgentPatch,
    answers: { 200: z.strictObject({ agent: Agent }) },
    errors: [invalidBody, [400, 'invalid_grant'], notFound],
  },
  {
    id: 'agents.token',
    package: 'WP3',
    method: 'POST',
    path: '/api/agents/:id/token',
    auth: 'session',
    answers: { 200: AgentWithToken },
    errors: [notFound],
  },
  {
    id: 'agents.revoke',
    package: 'WP3',
    method: 'DELETE',
    path: '/api/agents/:id',
    auth: 'session',
    answers: { 200: Ok },
    errors: [notFound],
  },
  {
    id: 'members',
    package: 'WP3',
    method: 'GET',
    path: '/api/members',
    auth: 'user',
    answers: { 200: Members },
    errors: [],
  },
  {
    id: 'access',
    package: 'WP3',
    method: 'GET',
    path: '/api/access',
    auth: 'user',
    query: AccessQuery,
    answers: { 200: Access },
    errors: [[400, 'invalid_query'], notFound],
  },
  {
    id: 'activity',
    package: 'WP3',
    method: 'GET',
    path: '/api/activity',
    auth: 'user',
    query: ActivityQuery,
    answers: { 200: ActivityPage },
    errors: [[400, 'invalid_query']],
  },

  // WP4: administration and data
  {
    id: 'auth.status',
    package: 'WP4',
    method: 'GET',
    path: '/api/auth/status',
    auth: 'none',
    answers: { 200: Status },
    errors: [],
  },
  {
    id: 'auth.register',
    package: 'WP4',
    method: 'POST',
    path: '/api/auth/register',
    auth: 'none',
    body: Registration,
    answers: { 201: UserAnswer },
    errors: [
      invalidBody,
      [409, 'email_taken'],
      [401, 'registration_closed'],
      [403, 'invite_required'],
      [403, 'invite_invalid'],
      [403, 'invite_expired'],
      [403, 'invite_used'],
      [403, 'invite_revoked'],
    ],
  },
  {
    id: 'auth.invite',
    package: 'WP4',
    method: 'GET',
    path: '/api/auth/invite/:token',
    auth: 'none',
    answers: { 200: Expiry },
    errors: [
      [404, 'invite_invalid'],
      [410, 'invite_expired'],
      [410, 'invite_used'],
      [410, 'invite_revoked'],
    ],
  },
  {
    id: 'auth.forgot',
    package: 'WP4',
    method: 'POST',
    path: '/api/auth/forgot',
    auth: 'none',
    body: Forgot,
    answers: { 200: Ok },
    errors: [
      invalidBody,
      [404, 'mail_not_configured'],
      [404, 'public_url_not_set'],
      [429, 'too_many_attempts'],
    ],
  },
  {
    id: 'auth.reset.check',
    package: 'WP4',
    method: 'GET',
    path: '/api/auth/reset/:token',
    auth: 'none',
    answers: { 200: Expiry },
    errors: [
      [404, 'reset_invalid'],
      [410, 'reset_expired'],
      [410, 'reset_used'],
      [403, 'account_blocked'],
    ],
  },
  {
    id: 'auth.reset',
    package: 'WP4',
    method: 'POST',
    path: '/api/auth/reset',
    auth: 'none',
    body: Reset,
    answers: { 200: Ok },
    errors: [
      invalidBody,
      [404, 'reset_invalid'],
      [410, 'reset_expired'],
      [410, 'reset_used'],
      [403, 'account_blocked'],
    ],
  },
  {
    id: 'auth.demo',
    package: 'WP4',
    method: 'GET',
    path: '/api/auth/demo',
    auth: 'none',
    answers: { 200: DemoAccounts },
    errors: [notFound],
  },
  {
    id: 'auth.demo.signIn',
    package: 'WP4',
    method: 'POST',
    path: '/api/auth/demo/:email',
    auth: 'none',
    answers: { 200: UserAnswer },
    errors: [notFound, [403, 'account_blocked']],
  },
  {
    id: 'invitations.list',
    package: 'WP4',
    method: 'GET',
    path: '/api/invitations',
    auth: 'admin:everything:manage',
    answers: { 200: z.strictObject({ invitations: z.array(Invitation) }) },
    errors: [],
  },
  {
    id: 'invitations.create',
    package: 'WP4',
    method: 'POST',
    path: '/api/invitations',
    auth: 'admin:everything:manage+session',
    answers: { 201: z.strictObject({ token: z.string(), invitation: Invitation }) },
    errors: [],
  },
  {
    id: 'invitations.withdraw',
    package: 'WP4',
    method: 'DELETE',
    path: '/api/invitations/:id',
    auth: 'admin:everything:manage+session',
    answers: { 200: Ok },
    errors: [notFound, [409, 'already_used']],
  },
  {
    id: 'admin.users',
    package: 'WP4',
    method: 'GET',
    path: '/api/admin/users',
    auth: 'admin',
    answers: { 200: z.strictObject({ users: z.array(AdminUser) }) },
    errors: [],
  },
  {
    id: 'admin.users.update',
    package: 'WP4',
    method: 'PATCH',
    path: '/api/admin/users/:id',
    auth: 'admin',
    body: UserPatch,
    answers: { 200: z.strictObject({ user: AdminUser }) },
    errors: [invalidBody, notFound, [409, 'self'], [409, 'last_admin']],
  },
  {
    id: 'admin.users.delete',
    package: 'WP4',
    method: 'DELETE',
    path: '/api/admin/users/:id',
    auth: 'admin',
    body: DeleteBody,
    answers: {
      200: z.strictObject({
        ok: z.literal(true),
        backup: z.string().nullable(),
        spaces: z.number().int(),
        entities: z.number().int(),
      }),
    },
    errors: [
      invalidBody,
      notFound,
      [409, 'self'],
      [409, 'not_blocked'],
      [400, 'confirm_mismatch'],
      [409, 'shared_space'],
    ],
  },
  {
    id: 'admin.users.resetLink',
    package: 'WP4',
    method: 'POST',
    path: '/api/admin/users/:id/reset-link',
    auth: 'admin',
    answers: { 201: z.strictObject({ token: z.string(), url: z.string(), expiresAt: Iso }) },
    errors: [notFound, [409, 'account_blocked']],
  },
  {
    id: 'admin.users.totpDisable',
    package: 'WP4',
    method: 'POST',
    path: '/api/admin/users/:id/totp/disable',
    auth: 'admin',
    answers: { 200: Ok },
    errors: [notFound],
  },
  {
    id: 'admin.registration',
    package: 'WP4',
    method: 'GET',
    path: '/api/admin/registration',
    auth: 'admin',
    answers: { 200: z.strictObject({ mode: z.enum(['closed', 'open', 'invite']) }) },
    errors: [],
  },
  {
    id: 'admin.registration.set',
    package: 'WP4',
    method: 'PUT',
    path: '/api/admin/registration',
    auth: 'admin',
    body: RegistrationBody,
    answers: { 200: z.strictObject({ mode: z.enum(['closed', 'open', 'invite']) }) },
    errors: [invalidBody],
  },
  {
    id: 'admin.backups',
    package: 'WP4',
    method: 'GET',
    path: '/api/admin/backups',
    auth: 'admin',
    answers: { 200: z.strictObject({ backups: z.array(Backup), canRestore: z.boolean() }) },
    errors: [notFound],
  },
  {
    id: 'admin.backups.create',
    package: 'WP4',
    method: 'POST',
    path: '/api/admin/backups',
    auth: 'admin',
    answers: { 201: z.strictObject({ backup: Backup }) },
    errors: [notFound],
  },
  {
    id: 'admin.backups.download',
    package: 'WP4',
    method: 'GET',
    path: '/api/admin/backups/:name',
    auth: 'admin',
    answers: { 200: SQLITE_FILE },
    errors: [notFound],
  },
  {
    id: 'admin.backups.restore',
    package: 'WP4',
    method: 'POST',
    path: '/api/admin/backups/:name/restore',
    auth: 'admin',
    answers: { 202: z.strictObject({ ok: z.literal(true), saved: z.string() }) },
    errors: [notFound, [422, 'invalid_backup']],
  },
  {
    id: 'admin.mail',
    package: 'WP4',
    method: 'GET',
    path: '/api/admin/mail',
    auth: 'admin',
    answers: { 200: z.strictObject({ configured: z.boolean(), from: z.string().nullable() }) },
    errors: [],
  },
  {
    id: 'admin.mail.test',
    package: 'WP4',
    method: 'POST',
    path: '/api/admin/mail/test',
    auth: 'admin',
    body: TestMail,
    answers: { 200: z.strictObject({ ok: z.literal(true), to: z.string() }) },
    errors: [
      [409, 'mail_not_configured'],
      [502, 'mail_failed'],
    ],
  },
  {
    id: 'export',
    package: 'WP4',
    method: 'GET',
    path: '/api/export',
    auth: 'everything:read',
    answers: { 200: ExportFile },
    errors: [],
  },
  {
    id: 'import',
    package: 'WP4',
    method: 'POST',
    path: '/api/import',
    auth: 'everything:manage',
    query: z.object({ mode: z.enum(['merge', 'reject']).default('merge') }),
    answers: { 200: ImportResult },
    errors: [
      [400, 'invalid_mode'],
      [400, 'invalid_export'],
      [409, 'account_not_empty'],
      [413, 'too_large'],
      [403, 'space_access'],
    ],
  },

  // Web push: the web app's reminders; not for native clients (spec/api.md §7).
  {
    id: 'push.key',
    package: 'web',
    method: 'GET',
    path: '/api/push/key',
    auth: 'everything:read',
    answers: { 200: z.strictObject({ publicKey: z.string() }) },
    errors: [],
  },
  {
    id: 'push.subscribe',
    package: 'web',
    method: 'POST',
    path: '/api/push/subscriptions',
    auth: 'everything:read',
    answers: { 201: Ok },
    errors: [invalidBody],
  },
  {
    id: 'push.unsubscribe',
    package: 'web',
    method: 'DELETE',
    path: '/api/push/subscriptions',
    auth: 'everything:read',
    answers: { 200: Ok },
    errors: [invalidBody],
  },
  {
    id: 'push.test',
    package: 'web',
    method: 'POST',
    path: '/api/push/test',
    auth: 'everything:read',
    answers: { 200: z.strictObject({ sent: z.number().int() }) },
    errors: [invalidBody],
  },
]

/** Answers and errors the tests do not provoke, and why. */
const NOT_EXERCISED: Record<string, string> = {
  'auth.register 403 invite_expired': 'needs an invitation 14 days old',
  'auth.invite 410 invite_expired': 'needs an invitation 14 days old',
  'auth.reset.check 410 reset_expired': 'needs a link older than its lifetime',
  'auth.reset 410 reset_expired': 'needs a link older than its lifetime',
  'auth.reset 403 account_blocked': 'same check as auth.reset.check',
  'auth.twoStep.enable 429 too_many_attempts': 'ten wrong codes in a row',
  'auth.twoStep.disable 429 too_many_attempts': 'ten wrong codes or passwords in a row',
  'auth.password 429 too_many_attempts': 'ten wrong passwords in a row',
  'auth.forgot 429 too_many_attempts': 'ten requests from one client in an hour',
  'calendars.add 400 feed_too_large': 'needs a feed over 10 MB',
  'admin.users.delete 409 shared_space': 'no endpoint makes a shared space with other members',
  'import 413 too_large': 'needs a body over 50 MB',
  'import 403 space_access': 'needs a space the user can see but not write',
  'admin.users.update 409 last_admin':
    'the acting administrator is always another unblocked administrator; only reachable without HTTP',
}

const json = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', reused: 'inline' })

function contract() {
  return {
    authKinds: {
      none: 'anyone',
      user: 'a session or any agent token; else 401 unauthorized',
      session: 'a session; else 401 unauthorized, a token 403 session_required',
      'everything:read':
        'a session, or a token with an `all` grant of at least read; else 401 unauthorized, another token 403 agent_scope',
      'everything:manage':
        'a session, or a token with an `all` grant at manage; else 401 unauthorized, another token 403 agent_scope',
      admin:
        'an administrator with a session; else 401 unauthorized, a token 403 session_required, a non-administrator 403 forbidden',
      'admin:everything:manage':
        'an administrator with a session or a token with `all` at manage; else 401 unauthorized, another token 403 agent_scope, a non-administrator 403 forbidden',
      'admin:everything:manage+session':
        'as admin:everything:manage, and a token gets 403 session_required',
    },
    error: json(ErrorBody),
    limits: {
      calendarRangeDays: MAX_RANGE_DAYS,
      calendarRefreshMs: REFRESH_MS,
      calendarRetryMs: RETRY_MS,
      activityDefaultLimit: DEFAULT_LIMIT,
      activityMaxLimit: MAX_LIMIT,
      activityScanBudget: SCAN_BUDGET,
      activityFoldGapMs: FOLD_GAP_MS,
      activityFoldSpanMs: FOLD_SPAN_MS,
      invitationTtlMs: INVITATION_TTL_MS,
      resetMailTtlMs: RESET_MAIL_TTL_MS,
      resetAdminTtlMs: RESET_ADMIN_TTL_MS,
      resetPerAddressPerHour: RESET_PER_ADDRESS,
      resetPerClientPerHour: RESET_PER_CLIENT,
      twoStepChallengeTtlMs: CHALLENGE_TTL_MS,
      recoveryCodes: RECOVERY_CODE_COUNT,
      importMaxBytes: MAX_IMPORT_BYTES,
    },
    endpoints: Object.fromEntries(
      ENDPOINTS.map((e) => [
        e.id,
        {
          package: e.package,
          route: `${e.method} ${e.path}`,
          auth: e.auth,
          ...(e.query ? { query: json(e.query) } : {}),
          ...(e.body ? { body: json(e.body) } : {}),
          answers: Object.fromEntries(
            Object.entries(e.answers).map(([status, a]) => [
              status,
              typeof a === 'string' ? a : json(a),
            ]),
          ),
          errors: e.errors.map(([status, code]) => `${status} ${code}`),
        },
      ]),
    ),
  }
}

// --- the apps under test ---

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dingen-rest-contract-'))
const backupDir = path.join(tmp, 'backups')
const restored: string[] = []

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:standup',
  'DTSTART;TZID=Europe/Amsterdam:20261112T090000',
  'DURATION:PT1H',
  'SUMMARY:Stand-up',
  'LOCATION:Room 1',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:trip',
  'DTSTART;VALUE=DATE:20261113',
  'DTEND;VALUE=DATE:20261116',
  'SUMMARY:Trip',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')
const FEEDS: Record<string, string | FeedError> = {
  'https://calendar.example.com/a.ics': ICS,
  'https://calendar.example.com/broken.ics': 'not a calendar',
}
const feedDown = false
async function fetchFeed(url: string): Promise<string> {
  const body = FEEDS[url]
  if (feedDown || body === undefined) throw new FeedError('feed_unreachable')
  if (body instanceof FeedError) throw body
  if (body === 'not a calendar') throw new FeedError('feed_invalid')
  return body
}

let mailFails = false
const mailConfig = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: null,
  password: null,
  from: 'Dingen <dingen@example.com>',
}
const mail = new MailService(mailConfig, async () => {
  if (mailFails) throw new Error('connection refused')
})

type Options = Partial<Parameters<typeof createApp>[0]>
function makeApp(options: Options | ((database: ReturnType<typeof openDatabase>) => Options) = {}) {
  const database = openDatabase(':memory:')
  const extra = typeof options === 'function' ? options(database) : options
  const app = createApp({
    db: database.db,
    version: 'test',
    sqliteVersion: database.sqliteVersion,
    registration: 'open',
    timezone: 'Europe/Amsterdam',
    fetchFeed,
    push: new PushService(database.db, 'BPublicKey', async () => 'sent'),
    ...extra,
  })
  return { app, database }
}

const main = makeApp((database) => ({
  mail,
  publicUrl: 'https://dingen.example.com',
  backups: {
    sqlite: database.sqlite,
    backupDir,
    migrationsFolder,
    restore: (file) => {
      restored.push(file)
    },
  },
}))
const bare = makeApp({ registration: 'closed' })
const noPublicUrl = makeApp({ mail })
const demo = makeApp({ demo: true })

afterAll(() => {
  for (const a of [main, bare, noPublicUrl, demo]) a.database.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

// --- calling and checking ---

type App = ReturnType<typeof makeApp>['app']
interface Call {
  method?: string
  body?: unknown
  raw?: string
  cookie?: string
  token?: string
}

function request(app: App, url: string, call: Call = {}) {
  const headers: Record<string, string> = {}
  if (call.body !== undefined || call.raw !== undefined)
    headers['content-type'] = 'application/json'
  if (call.cookie) headers.cookie = call.cookie
  if (call.token) headers.authorization = `Bearer ${call.token}`
  const body = call.raw ?? (call.body === undefined ? null : JSON.stringify(call.body))
  return Promise.resolve(app.request(url, { method: call.method ?? 'GET', headers, body }))
}

const seen = new Set<string>()
const byId = new Map(ENDPOINTS.map((e) => [e.id, e]))

function endpoint(id: string): Endpoint {
  const e = byId.get(id)
  if (!e) throw new Error(`unknown endpoint ${id}`)
  return e
}

/** Checks an answer against the contract and returns its body. */
async function answer<T = Record<string, unknown>>(
  id: string,
  res: Response,
  status: number,
): Promise<T> {
  const e = endpoint(id)
  const shape = e.answers[status]
  if (!shape) throw new Error(`${id} has no answer ${status}`)
  const text = await res.text()
  expect(res.status, `${id}: ${text.slice(0, 300)}`).toBe(status)
  seen.add(`${id} ${status}`)
  if (typeof shape === 'string') return text as T
  const body = JSON.parse(text)
  const parsed = shape.safeParse(body)
  expect(parsed.success ? null : parsed.error.issues, `${id} answer ${status}`).toBeNull()
  return body as T
}

/** Checks an error against the contract. */
async function error(id: string, res: Response, status: number, code: string): Promise<void> {
  const e = endpoint(id)
  const listed = e.errors.some(([s, c]) => s === status && c === code)
  expect(listed, `${id} lists ${status} ${code}`).toBe(true)
  const body = (await res.json()) as { error?: string }
  expect(res.status, `${id}: ${JSON.stringify(body)}`).toBe(status)
  expect(ErrorBody.safeParse(body).success, JSON.stringify(body)).toBe(true)
  expect(body.error).toBe(code)
  seen.add(`${id} ${status} ${code}`)
}

const PASSWORD = 'wachtwoord123'
const clock = createClock('CONTRACT')

async function register(app: App, email: string, invite?: string) {
  const res = await request(app, '/api/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, ...(invite ? { invite } : {}) },
  })
  const body = await answer<{ user: { id: string } }>('auth.register', res, 201)
  return { id: body.user.id, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' }
}

async function agentToken(
  cookie: string,
  grants: unknown[],
): Promise<{ id: string; token: string }> {
  const res = await request(main.app, '/api/agents', {
    method: 'POST',
    cookie,
    body: { name: 'Helper', icon: 'bot', color: 'blue', grants },
  })
  const body = await answer<{ agent: { id: string }; token: string }>('agents.create', res, 201)
  return { id: body.agent.id, token: body.token }
}

function change(entityType: Change['entityType'], entity: { id: string }): Change {
  const { id, ...fields } = entity as { id: string } & Record<string, unknown>
  return {
    id: ulid(),
    entityType,
    entityId: id,
    fields,
    ts: clock.now(),
    clientId: 'CONTRACT',
  }
}

function backupFile(kind: string, schema: string, content: Buffer | string): string {
  fs.mkdirSync(backupDir, { recursive: true })
  const name = `dingen-${kind}-2026-01-01T000000Z-${schema}.db`
  fs.writeFileSync(path.join(backupDir, name), content)
  return name
}

describe('REST API contract', () => {
  it('matches the pinned contract (see the comment above to update it)', async () => {
    await expect(`${JSON.stringify(contract(), null, 2)}\n`).toMatchFileSnapshot('./rest-api.json')
  })

  // The administrator: the first account. Bea: an ordinary user.
  let admin = { id: '', cookie: '' }
  let bea = { id: '', cookie: '' }
  let inboxToken = ''
  let readToken = ''
  let manageToken = ''
  let areaId = ''

  it('signs up and makes agents', async () => {
    await answer('auth.status', await request(main.app, '/api/auth/status'), 200)
    admin = await register(main.app, 'admin@example.com')
    bea = await register(main.app, 'bea@example.com')
    const area = { ...newArea({ title: 'Work', order: 'a0' }) }
    areaId = area.id
    const push = await request(main.app, '/api/sync/push', {
      method: 'POST',
      cookie: admin.cookie,
      body: { clientId: 'CONTRACT', changes: [change('area', area)] },
    })
    expect(push.status).toBe(200)
    inboxToken = (await agentToken(admin.cookie, [{ scope: 'inbox', level: 'edit' }])).token
    readToken = (await agentToken(admin.cookie, [{ scope: 'all', level: 'read' }])).token
    manageToken = (await agentToken(admin.cookie, [{ scope: 'all', level: 'manage' }])).token
    await answer('auth.status', await request(main.app, '/api/auth/status'), 200)
  })

  it('guards every endpoint as its auth says', async () => {
    const path = (e: Endpoint) =>
      e.path
        .replace(':id', '01M83XJG2035GE7YC9AMPACXG9')
        .replace(':name', 'x')
        .replace(':token', 'x')
        .replace(':email', 'x')
    for (const e of ENDPOINTS) {
      if (e.auth === 'none') continue
      const call = (extra: Call) => request(main.app, path(e), { method: e.method, ...extra })
      const expectError = async (res: Response, status: number, code: string, who: string) => {
        const body = (await res.json()) as { error?: string }
        expect([res.status, body.error], `${e.id} ${who}`).toEqual([status, code])
      }
      await expectError(await call({}), 401, 'unauthorized', 'anonymous')
      switch (e.auth) {
        case 'session':
          await expectError(await call({ token: manageToken }), 403, 'session_required', 'token')
          break
        case 'everything:read':
          await expectError(await call({ token: inboxToken }), 403, 'agent_scope', 'inbox token')
          break
        case 'everything:manage':
          await expectError(await call({ token: readToken }), 403, 'agent_scope', 'read token')
          break
        case 'admin':
          await expectError(await call({ token: manageToken }), 403, 'session_required', 'token')
          await expectError(await call({ cookie: bea.cookie }), 403, 'forbidden', 'non-admin')
          break
        case 'admin:everything:manage':
          await expectError(await call({ token: readToken }), 403, 'agent_scope', 'read token')
          await expectError(await call({ cookie: bea.cookie }), 403, 'forbidden', 'non-admin')
          break
        case 'admin:everything:manage+session':
          await expectError(await call({ token: readToken }), 403, 'agent_scope', 'read token')
          await expectError(await call({ token: manageToken }), 403, 'session_required', 'token')
          await expectError(await call({ cookie: bea.cookie }), 403, 'forbidden', 'non-admin')
          break
        case 'user':
          break
      }
    }
  })

  it('WP1: calendars and their events', async () => {
    const c = { cookie: admin.cookie }
    await answer('calendars.list', await request(main.app, '/api/calendars', c), 200)
    await error(
      'calendars.add',
      await request(main.app, '/api/calendars', { ...c, method: 'POST', body: { name: '' } }),
      400,
      'invalid_body',
    )
    const add = (url: string) =>
      request(main.app, '/api/calendars', {
        ...c,
        method: 'POST',
        body: { name: 'Work', url, color: 'blue', areaId },
      })
    await error('calendars.add', await add('ftp://calendar.example.com/a.ics'), 400, 'invalid_url')
    await error(
      'calendars.add',
      await add('https://calendar.example.com/gone.ics'),
      400,
      'feed_unreachable',
    )
    await error(
      'calendars.add',
      await add('https://calendar.example.com/broken.ics'),
      400,
      'feed_invalid',
    )
    const added = await answer<{ calendar: { id: string } }>(
      'calendars.add',
      await add('webcal://calendar.example.com/a.ics'),
      201,
    )
    const id = added.calendar.id
    await answer('calendars.list', await request(main.app, '/api/calendars', c), 200)
    await answer(
      'calendars.update',
      await request(main.app, `/api/calendars/${id}`, {
        ...c,
        method: 'PATCH',
        body: { name: 'Office', color: null, areaId: null },
      }),
      200,
    )
    await error(
      'calendars.update',
      await request(main.app, `/api/calendars/${id}`, { ...c, method: 'PATCH', body: {} }),
      400,
      'invalid_body',
    )
    await error(
      'calendars.update',
      await request(main.app, '/api/calendars/nope', {
        ...c,
        method: 'PATCH',
        body: { name: 'x' },
      }),
      404,
      'not_found',
    )
    const events = await answer<{ events: unknown[] }>(
      'calendars.events',
      await request(main.app, '/api/calendars/events?from=2026-11-10&to=2026-11-20', c),
      200,
    )
    expect(events.events).toHaveLength(2)
    await error(
      'calendars.events',
      await request(main.app, '/api/calendars/events?from=2026-01-01&to=2026-03-04', c),
      400,
      'invalid_range',
    )
    // Readable with a token that has `all` at read.
    await answer(
      'calendars.events',
      await request(main.app, '/api/calendars/events?from=2026-11-10&to=2026-11-10', {
        token: readToken,
      }),
      200,
    )
    await answer(
      'calendars.remove',
      await request(main.app, `/api/calendars/${id}`, { ...c, method: 'DELETE' }),
      200,
    )
    await error(
      'calendars.remove',
      await request(main.app, `/api/calendars/${id}`, { ...c, method: 'DELETE' }),
      404,
      'not_found',
    )
  })

  it('WP2: account, password, two-step and today-seen', async () => {
    const c = { cookie: bea.cookie }
    await answer('auth.me', await request(main.app, '/api/auth/me', c), 200)
    await answer('auth.me', await request(main.app, '/api/auth/me', { token: inboxToken }), 200)
    const pw = (body: unknown) =>
      request(main.app, '/api/auth/password', { ...c, method: 'POST', body })
    await error('auth.password', await pw({ password: 'short' }), 400, 'invalid_body')
    await error('auth.password', await pw({ password: 'a-new-password' }), 400, 'password_required')
    await error(
      'auth.password',
      await pw({ password: 'a-new-password', currentPassword: 'wrong-password' }),
      401,
      'invalid_credentials',
    )
    await answer('auth.password', await pw({ password: PASSWORD, currentPassword: PASSWORD }), 200)

    const post = (p: string, body?: unknown) =>
      request(main.app, `/api/auth/two-step${p}`, { ...c, method: 'POST', body })
    await answer('auth.twoStep', await request(main.app, '/api/auth/two-step', c), 200)
    await error('auth.twoStep.enable', await post('/enable', {}), 400, 'invalid_body')
    await error(
      'auth.twoStep.enable',
      await post('/enable', { code: '123456' }),
      400,
      'totp_not_started',
    )
    const setup = await answer<{ secret: string }>('auth.twoStep.setup', await post('/setup'), 200)
    await error('auth.twoStep.enable', await post('/enable', { code: 'nope' }), 400, 'invalid_code')
    const code = (offset = 0) => totpCode(setup.secret, totpStep() + offset)
    const codes = await answer<{ recoveryCodes: string[] }>(
      'auth.twoStep.enable',
      await post('/enable', { code: code() }),
      200,
    )
    expect(codes.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT)
    await error('auth.twoStep.setup', await post('/setup'), 409, 'totp_already_enabled')
    await error(
      'auth.twoStep.enable',
      await post('/enable', { code: code() }),
      409,
      'totp_already_enabled',
    )
    await answer('auth.twoStep', await request(main.app, '/api/auth/two-step', c), 200)
    await error('auth.twoStep.disable', await post('/disable', {}), 400, 'invalid_body')
    await error(
      'auth.twoStep.disable',
      await post('/disable', { password: 'wrong-password' }),
      401,
      'invalid_credentials',
    )
    await error(
      'auth.twoStep.disable',
      await post('/disable', { code: '000000' }),
      401,
      'invalid_code',
    )
    await answer('auth.twoStep.disable', await post('/disable', { password: PASSWORD }), 200)

    const seenOn = (body: unknown, extra: Call = c) =>
      request(main.app, '/api/auth/today-seen', { ...extra, method: 'POST', body })
    await error('auth.todaySeen', await seenOn({ date: 'today' }), 400, 'invalid_body')
    await answer('auth.todaySeen', await seenOn({ date: '2026-11-26' }), 200)
    await answer('auth.todaySeen', await seenOn({ date: '2026-11-26' }, { token: inboxToken }), 200)
  })

  it('WP3: agents, members, access and activity', async () => {
    const c = { cookie: admin.cookie }
    await answer('agents.list', await request(main.app, '/api/agents', c), 200)
    const create = (body: unknown) =>
      request(main.app, '/api/agents', { ...c, method: 'POST', body })
    await error('agents.create', await create({ name: 'x' }), 400, 'invalid_body')
    await error(
      'agents.create',
      await create({
        name: 'x',
        icon: 'bot',
        color: 'blue',
        grants: [{ scope: 'area', id: 'nope', level: 'read' }],
      }),
      400,
      'invalid_grant',
    )
    const made = await agentToken(admin.cookie, [{ scope: 'area', id: areaId, level: 'edit' }])
    const patch = (id: string, body: unknown) =>
      request(main.app, `/api/agents/${id}`, { ...c, method: 'PATCH', body })
    await answer('agents.update', await patch(made.id, { name: 'Claude', color: 'purple' }), 200)
    await error(
      'agents.update',
      await patch(made.id, { icon: 'no-such-icon' }),
      400,
      'invalid_body',
    )
    await error(
      'agents.update',
      await patch(made.id, { grants: [{ scope: 'project', id: 'nope', level: 'read' }] }),
      400,
      'invalid_grant',
    )
    await error('agents.update', await patch('nope', { name: 'x' }), 404, 'not_found')
    await answer(
      'agents.token',
      await request(main.app, `/api/agents/${made.id}/token`, { ...c, method: 'POST' }),
      200,
    )
    await error(
      'agents.token',
      await request(main.app, '/api/agents/nope/token', { ...c, method: 'POST' }),
      404,
      'not_found',
    )

    await answer('members', await request(main.app, '/api/members', c), 200)
    await answer('members', await request(main.app, '/api/members', { token: inboxToken }), 200)
    await answer('access', await request(main.app, `/api/access?type=area&id=${areaId}`, c), 200)
    await error(
      'access',
      await request(main.app, '/api/access?type=task&id=x', c),
      400,
      'invalid_query',
    )
    await error(
      'access',
      await request(main.app, '/api/access?type=area&id=nope', c),
      404,
      'not_found',
    )

    // Some history: a task added, then completed, then renamed by an agent.
    const task = newTask({ title: 'Write the spec', order: 'a0', areaId })
    const push = (changes: Change[], extra: Call = c) =>
      request(main.app, '/api/sync/push', {
        ...extra,
        method: 'POST',
        body: { clientId: 'CONTRACT', changes },
      })
    expect((await push([change('task', task)])).status).toBe(200)
    expect(
      (
        await push([change('task', { id: task.id, title: 'Write the API spec' } as never)], {
          token: manageToken,
        })
      ).status,
    ).toBe(200)
    const page = await answer<{ items: { kind: string }[]; nextBefore: number | null }>(
      'activity',
      await request(main.app, '/api/activity?limit=1', c),
      200,
    )
    expect(page.items[0]?.kind).toBe('updated')
    expect(page.nextBefore).not.toBeNull()
    await answer(
      'activity',
      await request(
        main.app,
        `/api/activity?before=${page.nextBefore}&kinds=added,updated&actor=user:${admin.id}&since=2026-01-01`,
        c,
      ),
      200,
    )
    await error(
      'activity',
      await request(main.app, '/api/activity?kinds=renamed', c),
      400,
      'invalid_query',
    )

    await answer(
      'agents.revoke',
      await request(main.app, `/api/agents/${made.id}`, { ...c, method: 'DELETE' }),
      200,
    )
    await error(
      'agents.revoke',
      await request(main.app, `/api/agents/${made.id}`, { ...c, method: 'DELETE' }),
      404,
      'not_found',
    )
  })

  it('WP4: registration, invitations and password resets', async () => {
    const c = { cookie: admin.cookie }
    const reg = (body: unknown, app = main.app) =>
      request(app, '/api/auth/register', { method: 'POST', body })
    await error('auth.register', await reg({ email: 'x' }), 400, 'invalid_body')
    await error(
      'auth.register',
      await reg({ email: 'bea@example.com', password: PASSWORD }),
      409,
      'email_taken',
    )
    const setMode = (mode: unknown) =>
      request(main.app, '/api/admin/registration', { ...c, method: 'PUT', body: { mode } })
    await error('admin.registration.set', await setMode('maybe'), 400, 'invalid_body')
    await answer('admin.registration.set', await setMode('closed'), 200)
    await answer('admin.registration', await request(main.app, '/api/admin/registration', c), 200)
    await error(
      'auth.register',
      await reg({ email: 'cas@example.com', password: PASSWORD }),
      401,
      'registration_closed',
    )
    await answer('admin.registration.set', await setMode('invite'), 200)
    await error(
      'auth.register',
      await reg({ email: 'cas@example.com', password: PASSWORD }),
      403,
      'invite_required',
    )
    await error(
      'auth.register',
      await reg({ email: 'cas@example.com', password: PASSWORD, invite: 'nope' }),
      403,
      'invite_invalid',
    )

    const invite = () =>
      request(main.app, '/api/invitations', { ...c, method: 'POST' }).then((res) =>
        answer<{ token: string; invitation: { id: string } }>('invitations.create', res, 201),
      )
    const first = await invite()
    await answer('auth.invite', await request(main.app, `/api/auth/invite/${first.token}`), 200)
    await error(
      'auth.invite',
      await request(main.app, '/api/auth/invite/nope'),
      404,
      'invite_invalid',
    )
    const cas = await register(main.app, 'cas@example.com', first.token)
    await error(
      'auth.invite',
      await request(main.app, `/api/auth/invite/${first.token}`),
      410,
      'invite_used',
    )
    await error(
      'auth.register',
      await reg({ email: 'dirk@example.com', password: PASSWORD, invite: first.token }),
      403,
      'invite_used',
    )
    await error(
      'invitations.withdraw',
      await request(main.app, `/api/invitations/${first.invitation.id}`, {
        ...c,
        method: 'DELETE',
      }),
      409,
      'already_used',
    )
    const second = await invite()
    await answer(
      'invitations.withdraw',
      await request(main.app, `/api/invitations/${second.invitation.id}`, {
        ...c,
        method: 'DELETE',
      }),
      200,
    )
    await error(
      'invitations.withdraw',
      await request(main.app, '/api/invitations/nope', { ...c, method: 'DELETE' }),
      404,
      'not_found',
    )
    await error(
      'auth.invite',
      await request(main.app, `/api/auth/invite/${second.token}`),
      410,
      'invite_revoked',
    )
    await error(
      'auth.register',
      await reg({ email: 'dirk@example.com', password: PASSWORD, invite: second.token }),
      403,
      'invite_revoked',
    )
    await answer('invitations.list', await request(main.app, '/api/invitations', c), 200)
    await answer(
      'invitations.list',
      await request(main.app, '/api/invitations', { token: manageToken }),
      200,
    )
    await answer('admin.registration.set', await setMode('open'), 200)

    // Forgot password and reset links.
    const forgot = (app: App, body: unknown) =>
      request(app, '/api/auth/forgot', { method: 'POST', body })
    await answer(
      'auth.forgot',
      await forgot(main.app, { email: 'nobody@example.com', language: 'en' }),
      200,
    )
    await error('auth.forgot', await forgot(main.app, {}), 400, 'invalid_body')
    await error(
      'auth.forgot',
      await forgot(bare.app, { email: 'x@example.com' }),
      404,
      'mail_not_configured',
    )
    await error(
      'auth.forgot',
      await forgot(noPublicUrl.app, { email: 'x@example.com' }),
      404,
      'public_url_not_set',
    )
    const link = (id: string) =>
      request(main.app, `/api/admin/users/${id}/reset-link`, { ...c, method: 'POST' })
    const made = await answer<{ token: string }>('admin.users.resetLink', await link(cas.id), 201)
    await error('admin.users.resetLink', await link('nope'), 404, 'not_found')
    await answer('auth.reset.check', await request(main.app, `/api/auth/reset/${made.token}`), 200)
    await error(
      'auth.reset.check',
      await request(main.app, '/api/auth/reset/nope'),
      404,
      'reset_invalid',
    )
    const reset = (body: unknown) => request(main.app, '/api/auth/reset', { method: 'POST', body })
    await error('auth.reset', await reset({ token: made.token }), 400, 'invalid_body')
    await error(
      'auth.reset',
      await reset({ token: 'nope', password: PASSWORD }),
      404,
      'reset_invalid',
    )
    await answer('auth.reset', await reset({ token: made.token, password: PASSWORD }), 200)
    await error(
      'auth.reset',
      await reset({ token: made.token, password: PASSWORD }),
      410,
      'reset_used',
    )
    await error(
      'auth.reset.check',
      await request(main.app, `/api/auth/reset/${made.token}`),
      410,
      'reset_used',
    )
    const later = await answer<{ token: string }>('admin.users.resetLink', await link(cas.id), 201)

    // Users: block, admin rights, two-step off, delete.
    await answer('admin.users', await request(main.app, '/api/admin/users', c), 200)
    const patch = (id: string, body: unknown) =>
      request(main.app, `/api/admin/users/${id}`, { ...c, method: 'PATCH', body })
    await error('admin.users.update', await patch(cas.id, {}), 400, 'invalid_body')
    await error('admin.users.update', await patch('nope', { blocked: true }), 404, 'not_found')
    await error('admin.users.update', await patch(admin.id, { blocked: true }), 409, 'self')
    await error('admin.users.update', await patch(admin.id, { isAdmin: false }), 409, 'self')
    await answer('admin.users.update', await patch(cas.id, { blocked: true }), 200)
    await error(
      'auth.reset.check',
      await request(main.app, `/api/auth/reset/${later.token}`),
      403,
      'account_blocked',
    )
    await error('admin.users.resetLink', await link(cas.id), 409, 'account_blocked')
    await answer('admin.users.update', await patch(bea.id, { isAdmin: true }), 200)
    await answer('admin.users.update', await patch(bea.id, { isAdmin: false }), 200)
    const a = c

    const totpOff = (id: string) =>
      request(main.app, `/api/admin/users/${id}/totp/disable`, { ...a, method: 'POST' })
    await answer('admin.users.totpDisable', await totpOff(bea.id), 200)
    await error('admin.users.totpDisable', await totpOff('nope'), 404, 'not_found')

    const del = (id: string, body: unknown) =>
      request(main.app, `/api/admin/users/${id}`, { ...a, method: 'DELETE', body })
    await error('admin.users.delete', await del(cas.id, {}), 400, 'invalid_body')
    await error('admin.users.delete', await del('nope', { confirm: 'x' }), 404, 'not_found')
    await error(
      'admin.users.delete',
      await del(admin.id, { confirm: 'admin@example.com' }),
      409,
      'self',
    )
    await error(
      'admin.users.delete',
      await del(bea.id, { confirm: 'bea@example.com' }),
      409,
      'not_blocked',
    )
    await error(
      'admin.users.delete',
      await del(cas.id, { confirm: 'bea@example.com' }),
      400,
      'confirm_mismatch',
    )
    await answer('admin.users.delete', await del(cas.id, { confirm: 'CAS@example.com' }), 200)
  })

  it('WP4: backups and mail', async () => {
    const a = { cookie: admin.cookie }
    const list = await answer<{ backups: unknown[] }>(
      'admin.backups',
      await request(main.app, '/api/admin/backups', a),
      200,
    )
    expect(Array.isArray(list.backups)).toBe(true)
    const made = await answer<{ backup: { name: string } }>(
      'admin.backups.create',
      await request(main.app, '/api/admin/backups', { ...a, method: 'POST' }),
      201,
    )
    await answer('admin.backups', await request(main.app, '/api/admin/backups', a), 200)
    const file = await request(main.app, `/api/admin/backups/${made.backup.name}`, a)
    expect(file.headers.get('content-type')).toBe('application/vnd.sqlite3')
    await answer('admin.backups.download', file, 200)
    await error(
      'admin.backups.download',
      await request(main.app, '/api/admin/backups/nope.db', a),
      404,
      'not_found',
    )
    const restore = (name: string) =>
      request(main.app, `/api/admin/backups/${name}/restore`, { ...a, method: 'POST' })
    await error('admin.backups.restore', await restore('nope.db'), 404, 'not_found')
    const junk = backupFile('manual', '0001', 'not a database')
    await error('admin.backups.restore', await restore(junk), 422, 'invalid_backup')
    await answer('admin.backups.restore', await restore(made.backup.name), 202)

    const b = await register(bare.app, 'admin@example.com')
    await error('admin.backups', await request(bare.app, '/api/admin/backups', b), 404, 'not_found')
    await error(
      'admin.backups.create',
      await request(bare.app, '/api/admin/backups', { ...b, method: 'POST' }),
      404,
      'not_found',
    )

    await answer('admin.mail', await request(main.app, '/api/admin/mail', a), 200)
    await answer('admin.mail', await request(bare.app, '/api/admin/mail', b), 200)
    const test = (app: App, cookie: string) =>
      request(app, '/api/admin/mail/test', { cookie, method: 'POST', body: { language: 'nl' } })
    await answer('admin.mail.test', await test(main.app, admin.cookie), 200)
    mailFails = true
    await error('admin.mail.test', await test(main.app, admin.cookie), 502, 'mail_failed')
    mailFails = false
    await error('admin.mail.test', await test(bare.app, b.cookie), 409, 'mail_not_configured')
  })

  it('WP4: export and import', async () => {
    const a = { cookie: admin.cookie }
    const res = await request(main.app, '/api/export', a)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="dingen-export-/)
    const file = await answer('export', res, 200)
    await answer('export', await request(main.app, '/api/export', { token: readToken }), 200)
    const imp = (query: string, body: unknown, extra: Call = a) =>
      request(main.app, `/api/import${query}`, { ...extra, method: 'POST', body })
    await answer('import', await imp('', file), 200)
    await answer('import', await imp('?mode=merge', file, { token: manageToken }), 200)
    await error('import', await imp('?mode=replace', file), 400, 'invalid_mode')
    await error('import', await imp('', { format: 'other' }), 400, 'invalid_export')
    await error('import', await imp('?mode=reject', file), 409, 'account_not_empty')
  })

  it('WP4: demo accounts', async () => {
    await error('auth.demo', await request(main.app, '/api/auth/demo'), 404, 'not_found')
    const sam = await register(demo.app, 'sam@example.com')
    const morgan = await register(demo.app, 'morgan@example.com')
    const blocked = await request(demo.app, `/api/admin/users/${morgan.id}`, {
      cookie: sam.cookie,
      method: 'PATCH',
      body: { blocked: true },
    })
    expect(blocked.status).toBe(200)
    await error(
      'auth.demo.signIn',
      await request(demo.app, '/api/auth/demo/morgan@example.com', { method: 'POST' }),
      403,
      'account_blocked',
    )
    await answer('auth.demo', await request(demo.app, '/api/auth/demo'), 200)
    await answer(
      'auth.demo.signIn',
      await request(demo.app, '/api/auth/demo/sam@example.com', { method: 'POST' }),
      200,
    )
    await error(
      'auth.demo.signIn',
      await request(demo.app, '/api/auth/demo/someone@example.com', { method: 'POST' }),
      404,
      'not_found',
    )
  })

  it('web push', async () => {
    const a = { cookie: admin.cookie }
    await answer('push.key', await request(main.app, '/api/push/key', a), 200)
    const target = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' } }
    const sub = (method: string, body: unknown) =>
      request(main.app, '/api/push/subscriptions', { ...a, method, body })
    await error(
      'push.subscribe',
      await sub('POST', { endpoint: 'http://push.example.com/x' }),
      400,
      'invalid_body',
    )
    await answer('push.subscribe', await sub('POST', { ...target, language: 'nl' }), 201)
    await answer(
      'push.test',
      await request(main.app, '/api/push/test', { ...a, method: 'POST', body: { title: 'Test' } }),
      200,
    )
    await error(
      'push.test',
      await request(main.app, '/api/push/test', { ...a, method: 'POST', body: { title: 1 } }),
      400,
      'invalid_body',
    )
    await error('push.unsubscribe', await sub('DELETE', {}), 400, 'invalid_body')
    await answer('push.unsubscribe', await sub('DELETE', { endpoint: target.endpoint }), 200)
  })

  it('saw every answer and error of the contract', () => {
    const missing: string[] = []
    for (const e of ENDPOINTS) {
      for (const status of Object.keys(e.answers)) {
        if (!seen.has(`${e.id} ${status}`)) missing.push(`${e.id} ${status}`)
      }
      for (const [status, code] of e.errors) {
        const key = `${e.id} ${status} ${code}`
        if (!seen.has(key) && !NOT_EXERCISED[key]) missing.push(key)
      }
    }
    expect(missing).toEqual([])
    expect(restored).toHaveLength(1)
  })
})
