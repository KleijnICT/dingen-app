# Dingen specification

Everything a client needs to work with a Dingen server, without reading the
TypeScript code. Written for native clients in other languages.

| File                                  | What it is                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [protocol.md](protocol.md)            | The sync protocol (version 4): signing in, push, pull, snapshot, and the algorithm a client follows.                      |
| [entities.md](entities.md)            | Every entity type and field, with defaults and rules.                                                                     |
| [api.md](api.md)                      | The REST endpoints besides sync: calendars, account and settings, agents and activity, administration, export and import. |
| [conformance/](conformance/README.md) | The test set: operations with their input and expected output, as JSON. A client must pass it.                            |

## Rules for a client

- Build against these files. Where they are silent or unclear, that is a gap
  in the specification: report it, do not guess from the web app.
- Data (areas, projects, headings, tasks, checklist items, tags) goes only
  through the sync protocol. Signing in, account, settings, calendars,
  agents, activity, administration, export and import use the endpoints in
  [protocol.md](protocol.md) §10–11 and [api.md](api.md), and no others.
- Logic that every client needs to agree on (views, review, Today, tags,
  search, durations, reminders, …) is fixed by the conformance set, not by
  the web app's code.
- The sync protocol only grows until 2.0: new optional fields with a default,
  new entity types. A client must ignore entity types it does not know and
  must keep fields it does not know.
- A client records which version of the test set it passes
  (`conformance/manifest.json`, `version`).

## How the files stay true

`conformance/*.json` is generated from `@dingen/core`
(`packages/core/src/conformance.test.ts`) and pinned in CI: a change in
behaviour fails the build until the files and the version are updated with
it. The shapes of the protocol are pinned the same way in
`apps/server/test/contract/sync-protocol.json`, which is the machine-readable
form (JSON Schema) of entities.md and of the requests and answers in
protocol.md.

The REST endpoints are pinned in `apps/server/test/contract/rest-api.json`:
for every endpoint of api.md (and the auth endpoints of protocol.md §10.5
that settings use) its route, who may call it, its request (from the
server's own validation), its answers and its errors, plus the limits
(lifetimes, rate limits, sizes). The test calls every endpoint on a server
and fails when an answer has a field more or less than its schema, an error
is not in the list, or an endpoint lets in someone its `auth` excludes. Every
listed answer and error is provoked at least once, except the few the test
names in `NOT_EXERCISED` (they need hours of waiting, 50 MB bodies or a
state no endpoint can make).

### Not pinned yet

What api.md describes but no test fails on when it changes:

- The text around the shapes: orders (calendars, agents, users, back-ups,
  invitations), the meaning of fields, which side effects an endpoint has
  (sessions ended by blocking or a reset, the back-up before deleting a
  user), the order in which checks run.
- How activity lines are made: folding, the kinds, which fields an
  `updated` line lists, and paging with the scan budget. The server's own
  tests (`apps/server/src/activity/activity.test.ts`) cover it, not the
  contract.
- How calendar events are expanded from ICS (repeats, exceptions, time
  zones, all-day and multi-day); only the event shape is pinned. Covered by
  `apps/server/src/calendar/ics.test.ts` and `calendars.test.ts`.
- The rules of import (where records land, merging, skipping), beyond the
  answer shape.
- The contents of `issues` (deliberately not a contract).
- `POST /api/auth/login`, `POST /api/auth/login/two-step`,
  `POST /api/auth/logout` and `GET /api/health` (protocol.md §10–11) are
  not in rest-api.json; `me`, `status`, `members` and `access` are.
