import {
  Change,
  CLIENT_OUTDATED,
  CLIENT_OUTDATED_STATUS,
  ClientOutdatedBodySchema,
  EntityType,
  entitySchemas,
  MAX_PUSH_CHANGES,
  MIN_CLIENT_PROTOCOL,
  PROTOCOL_HEADER,
  PullResponseSchema,
  PushRequestSchema,
  PushResponseSchema,
  SnapshotResponseSchema,
  SPACE_FIELD,
  SYNC_PROTOCOL,
} from '@dingen/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * The contract of the sync protocol, pinned (plan 33).
 *
 * `sync-protocol.json` next to this file is generated from the zod schemas in
 * packages/core (entities.ts, protocol.ts): the protocol number, the header,
 * every entity type with its fields, a change, and the request and answer of
 * pull, push and snapshot. Any change to them makes this test fail, so it
 * shows up as a diff of that file in review.
 *
 * The rule from 1.0.0-beta.1 until 2.0: only additive changes.
 * - Allowed: a new optional field with a default (`.default(...)`, so data
 *   and clients without it keep working), a new entity type (older clients
 *   skip types they do not know), a new optional field in an answer, a looser
 *   check.
 * - Not allowed: renaming or removing a field or entity type, making a field
 *   required or stricter, changing what a value means, changing
 *   `SYNC_PROTOCOL` (that is 2.0).
 *
 * After an allowed change: run `pnpm --filter @dingen/server test -u`, check
 * that the diff of sync-protocol.json only adds, and commit it with the change.
 */

const json = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', reused: 'inline' })

function contract() {
  return {
    protocol: SYNC_PROTOCOL,
    minClientProtocol: MIN_CLIENT_PROTOCOL,
    header: PROTOCOL_HEADER,
    spaceField: SPACE_FIELD,
    maxPushChanges: MAX_PUSH_CHANGES,
    outdated: {
      status: CLIENT_OUTDATED_STATUS,
      error: CLIENT_OUTDATED,
      body: json(ClientOutdatedBodySchema),
    },
    entityTypes: EntityType.options,
    entities: Object.fromEntries(
      EntityType.options.map((type) => [type, json(entitySchemas[type])]),
    ),
    change: json(Change),
    pull: {
      request: 'GET /api/sync/pull?cursor=<URL-encoded JSON {"<spaceId>": seq}>',
      response: json(PullResponseSchema),
    },
    push: {
      request: { route: 'POST /api/sync/push', body: json(PushRequestSchema) },
      response: json(PushResponseSchema),
    },
    snapshot: {
      request: 'GET /api/sync/snapshot[?space=<id>]',
      response: json(SnapshotResponseSchema),
    },
  }
}

describe('sync protocol contract', () => {
  it('matches the pinned contract (see the comment above to update it)', async () => {
    await expect(`${JSON.stringify(contract(), null, 2)}\n`).toMatchFileSnapshot(
      './sync-protocol.json',
    )
  })

  it('stays protocol 4 until 2.0', () => {
    expect(SYNC_PROTOCOL).toBe(4)
    expect(MIN_CLIENT_PROTOCOL).toBe(4)
  })
})
