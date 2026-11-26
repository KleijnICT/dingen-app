# Dingen REST API

The endpoints a native client needs besides the sync protocol: calendars,
the account and its settings, agents and the activity log, and
administration and data. [protocol.md](protocol.md) covers syncing,
signing in (§10) and health, members and access (§11); this file refers to
it and does not repeat it.

It describes what the server does at 1.0.0-beta.2. Where it is silent or
unclear, that is a gap in the specification: report it, do not guess from
the web app.

The endpoints are grouped by the four work packages of Phase B in the
native clients' parity plan (`PARITY.md` in the client repositories):

| Section                                                           | Package | Features        |
| ----------------------------------------------------------------- | ------- | --------------- |
| [2. Review and calendars](#2-review-and-calendars)                | WP1     | B1, B2, B3.10   |
| [3. Account and settings](#3-account-and-settings)                | WP2     | B3, A4.11, B7.1 |
| [4. Agents, members and activity](#4-agents-members-and-activity) | WP3     | B4              |
| [5. Administration and data](#5-administration-and-data)          | WP4     | B5, B6, A1.7–8  |

The words "must", "must not" and "may" are normative.

## Contents

1. [Conventions](#1-conventions)
2. [Review and calendars](#2-review-and-calendars)
3. [Account and settings](#3-account-and-settings)
4. [Agents, members and activity](#4-agents-members-and-activity)
5. [Administration and data](#5-administration-and-data)
6. [Web push (not for native clients)](#6-web-push-not-for-native-clients)
7. [Error codes](#7-error-codes)
8. [Open points](#8-open-points)

---

## 1. Conventions

### 1.1 Requests and answers

- Paths are relative to the server address (`https://doe.dingen.app`).
  Everything is under `/api/`.
- Bodies are JSON (`content-type: application/json`), in both directions,
  unless an endpoint says otherwise (a back-up download is a file).
- A request body field the server does not know is ignored. A body that is
  missing or is not JSON counts as an empty one and fails validation.
- The protocol header `x-dingen-protocol` (protocol.md §1.2) is not needed
  here; sending it does no harm.
- Answers only grow until 2.0 (protocol.md §1.3): a client must ignore
  fields it does not know, and must read a field that is marked "present
  only when …" as absent otherwise.
- During a restore from a back-up (§5.7) every request, `/api/health`
  included, answers 503 `{"error":"restarting"}` with `Retry-After: 2`.

### 1.2 Who may call an endpoint

How a request is authenticated is in protocol.md §10.1: a session (the
`dingen_session` cookie a native client sends as `Cookie`) or an agent's
bearer token. Every endpoint below has one of these **auth** values:

| Auth                     | Who                                                                          | Otherwise                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| none                     | Anyone.                                                                      | —                                                                                          |
| user                     | A session, or any agent token (acting for the agent's owner).                | 401 `unauthorized`.                                                                        |
| session                  | A session only.                                                              | 401 `unauthorized`; a token gets 403 `session_required`.                                   |
| everything:read          | A session, or a token whose agent has an `all` grant of at least `read`.     | 401 `unauthorized`; another token gets 403 `agent_scope`.                                  |
| everything:manage        | A session, or a token whose agent has an `all` grant at `manage`.            | 401 `unauthorized`; another token gets 403 `agent_scope`.                                  |
| admin                    | An administrator with a session.                                             | 401 `unauthorized`; any token 403 `session_required`; a non-administrator 403 `forbidden`. |
| admin, everything:manage | An administrator, with a session or a token with `all` at `manage`.          | 401 `unauthorized`; another token 403 `agent_scope`; a non-administrator 403 `forbidden`.  |
| admin, session           | As "admin, everything:manage", and a token then gets 403 `session_required`. | As the row above.                                                                          |

The checks run in the order of the "Otherwise" column, before the body is
read. A native app used by a person signs in with a session, so for it
every endpoint here is open as far as the account allows.

### 1.3 Errors

Every error answer is a JSON object with an `error` code:

```json
{ "error": "invalid_body", "issues": [ ... ] }
```

| Field     | Present                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`   | Always. A stable code: [section 7](#7-error-codes) lists them all. Map it to text in the client's language.                                                                                         |
| `issues`  | With `invalid_body` and `invalid_query` on most endpoints (each section says where), `invalid_export` and `invalid_backup`. For display or logging only; its contents are not part of the contract. |
| `detail`  | With `mail_failed`: the mail server's reason, in English.                                                                                                                                           |
| `message` | With `space_access`: a sentence in English.                                                                                                                                                         |

Codes that any endpoint can give, in addition to those it lists:

| Status | `error`            | When                                                       |
| ------ | ------------------ | ---------------------------------------------------------- |
| 401    | `unauthorized`     | No valid session or token, where one is needed (§1.2).     |
| 403    | `session_required` | A token where only a session is accepted (§1.2).           |
| 403    | `agent_scope`      | A token without the `all` grant the endpoint needs (§1.2). |
| 403    | `forbidden`        | Not an administrator (§1.2).                               |
| 404    | `not_found`        | An unknown path under `/api/` (protocol.md §11.4).         |
| 500    | `internal`         | A fault in the server. Retrying may help; report it.       |
| 503    | `restarting`       | A restore is running (§1.1).                               |

### 1.4 Values

- **Instant**: an ISO 8601 date-time in UTC with milliseconds,
  `2026-11-26T09:30:00.000Z`.
- **Date**: a calendar date `YYYY-MM-DD` without a time zone.
- **Id**: entity and account ids are ULIDs (protocol.md §2.1); treat every
  id as an opaque string.
- **Icon** and **colour** ids are the area icons and colours of
  [entities.md](entities.md) (`area.icon`, `area.color`). Agents and
  calendars use the same lists; unlike an area, they only accept a listed
  id.

### 1.5 How this file stays true

`apps/server/test/contract/rest-api.json` is the machine-readable form of
this file: for every endpoint its route, its auth, its request (as JSON
Schema, from the server's own validation) and its answers and errors. Its
test calls every endpoint on a running server and checks each answer
against that schema with no field missing or extra, each listed error, and
each auth value. A change to any of it fails the build until the file and
this text are updated together. What it does not pin is listed in
[README.md](README.md).

---

## 2. Review and calendars

### 2.1 Review

Review needs no endpoint. `reviewedAt` and `reviewEvery` are fields of
areas and projects, written through sync ([entities.md](entities.md)).
Marking an item reviewed is a change that sets `reviewedAt` to now.

Which items are due, in which order, which item comes next after marking
one reviewed, how long ago an item was reviewed and how many open tasks it
holds are client logic, fixed by the conformance suite `review`
([conformance/](conformance/README.md)).

### 2.2 Calendars and events

A calendar is an ICS feed (a secret iCal address) the server fetches for
the user. Calendars are not synced entities: they live only on the server,
per account, and are reached through the endpoints below. The feed address
is a secret: no answer and no error ever contains it, only its `host`.

**Calendar** (as the endpoints answer it):

| Field       | Type            | Meaning                                                                                                                    |
| ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`        | Id              |                                                                                                                            |
| `name`      | string          | 1 to 100 characters.                                                                                                       |
| `color`     | colour id, null | `null`: the neutral colour.                                                                                                |
| `areaId`    | Id or null      | The area the calendar belongs to, for Today's area filter; `null` is none. The server does not check that the area exists. |
| `host`      | string          | The host of the feed address, for display (`calendar.example.com`).                                                        |
| `createdAt` | Instant         |                                                                                                                            |

Calendars come back in the order they were added.

#### `GET /api/calendars`

Auth: everything:read.

```json
{
  "calendars": [
    {
      "id": "01M8BRCER51R8AAW1K7ZPRRA1R",
      "name": "Work",
      "color": "blue",
      "areaId": "01M8BRCEMB6FG3A28BJEM8ZQMP",
      "host": "calendar.example.com",
      "createdAt": "2026-11-26T11:03:22.629Z"
    }
  ]
}
```

#### `POST /api/calendars`

Auth: everything:manage. Adds a calendar after fetching and reading the
feed once.

```json
{ "name": "Work", "url": "webcal://calendar.example.com/a.ics", "color": "blue", "areaId": null }
```

| Field    | Rules                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`   | Required; trimmed, 1 to 100 characters.                                                                                                                                                      |
| `url`    | Required; 1 to 4096 characters. `webcal://` and `webcals://` become `https://`; then only `http` and `https`. A user name and password in the address are sent as HTTP Basic authentication. |
| `color`  | A colour id or `null`; default `null`.                                                                                                                                                       |
| `areaId` | 1 to 64 characters or `null`; default `null`.                                                                                                                                                |

**Response 201**: `{ "calendar": Calendar }`.

| Status | Body                           | When                                                                               |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_body"}`     | Body invalid (no `issues`: they could contain the address).                        |
| 400    | `{"error":"invalid_url"}`      | Not an address, or not http(s) after the `webcal` rewrite.                         |
| 400    | `{"error":"feed_unreachable"}` | The fetch failed: network error, timeout (15 s), or an HTTP status other than 2xx. |
| 400    | `{"error":"feed_invalid"}`     | The answer is not an iCalendar file (`BEGIN:VCALENDAR`).                           |
| 400    | `{"error":"feed_too_large"}`   | The feed is larger than 10 MB.                                                     |

#### `PATCH /api/calendars/:id`

Auth: everything:manage. Changes the name, colour or area; the address
cannot be changed (remove the calendar and add it again).

```json
{ "name": "Office", "color": null, "areaId": null }
```

Every field is optional, with the rules of `POST`; at least one must be
there. **Response 200**: `{ "calendar": Calendar }`.

| Status | Body                                      | When                                   |
| ------ | ----------------------------------------- | -------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body invalid, or no field to change.   |
| 404    | `{"error":"not_found"}`                   | No calendar with this id for the user. |

#### `DELETE /api/calendars/:id`

Auth: everything:manage. **Response 200** `{"ok": true}`; 404
`not_found` when there is no such calendar.

#### `GET /api/calendars/events`

Auth: everything:read. The events of all the user's calendars that touch a
range of days, expanded (repeats, exceptions and time zones worked out by
the server).

```
GET /api/calendars/events?from=2026-11-10&to=2026-11-20
```

`from` and `to` are dates, `from` ≤ `to`, and the range is at most **62
days** including both ends (`to` at most 61 days after `from`). Otherwise
400 `{"error":"invalid_range"}` (no `issues`).

**The server's time zone.** Days and clock times are in the server's time
zone (`DINGEN_TIMEZONE`, default `Europe/Amsterdam`), not the device's: the
range `from`–`to` is read in that zone, and `startDate`, `endDate`,
`startTime` and `endTime` are in it. The answer says which zone it is. A
client in another zone can use `start` and `end` (instants) for timed
events.

**Response 200**

```json
{
  "timezone": "Europe/Amsterdam",
  "calendars": [
    { "id": "01M8BRCER51R8AAW1K7ZPRRA1R", "name": "Office", "color": null, "areaId": null }
  ],
  "events": [
    {
      "id": "01M8BRCER51R8AAW1K7ZPRRA1R:standup:2026-11-12T08:00:00.000Z",
      "calendarId": "01M8BRCER51R8AAW1K7ZPRRA1R",
      "title": "Stand-up",
      "location": "Room 1",
      "allDay": false,
      "startDate": "2026-11-12",
      "endDate": "2026-11-12",
      "startTime": "09:00",
      "endTime": "10:00",
      "start": "2026-11-12T08:00:00.000Z",
      "end": "2026-11-12T09:00:00.000Z"
    },
    {
      "id": "01M8BRCER51R8AAW1K7ZPRRA1R:trip:2026-11-13",
      "calendarId": "01M8BRCER51R8AAW1K7ZPRRA1R",
      "title": "Trip",
      "location": null,
      "allDay": true,
      "startDate": "2026-11-13",
      "endDate": "2026-11-15",
      "startTime": null,
      "endTime": null,
      "start": "2026-11-13T00:00:00.000Z",
      "end": "2026-11-16T00:00:00.000Z"
    }
  ],
  "failed": []
}
```

| Field       | Meaning                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `timezone`  | The IANA zone days and times are in.                                                                           |
| `calendars` | Every calendar of the user: `id`, `name`, `color`, `areaId`. Look up an event's calendar here.                 |
| `events`    | Sorted by `start`, then `id`.                                                                                  |
| `failed`    | Ids of calendars with no events to give: their feed has never been read successfully since the server started. |

**Event**

| Field        | Type          | Meaning                                                                                                                                                        |
| ------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | string        | Unique per occurrence: `<calendarId>:<UID>:<start>`, where start is the date for an all-day event and the instant otherwise. Use it as a key; do not parse it. |
| `calendarId` | Id            |                                                                                                                                                                |
| `title`      | string        | The summary, trimmed; may be empty.                                                                                                                            |
| `location`   | string, null  | Trimmed; `null` when empty.                                                                                                                                    |
| `allDay`     | boolean       |                                                                                                                                                                |
| `startDate`  | Date          | First day.                                                                                                                                                     |
| `endDate`    | Date          | Last day, inclusive. An event that ends at midnight does not reach the next day.                                                                               |
| `startTime`  | `HH:MM`, null | `null` for an all-day event.                                                                                                                                   |
| `endTime`    | `HH:MM`, null | `null` for an all-day event. On a multi-day event this is the time on `endDate`.                                                                               |
| `start`      | Instant       | All-day: midnight UTC of `startDate`.                                                                                                                          |
| `end`        | Instant       | All-day: midnight UTC of the day after `endDate` (exclusive).                                                                                                  |

An event is in the answer when it overlaps the range: all-day events by
their days, timed events by their instants (an event without a duration
counts when it starts inside the range). Cancelled events
(`STATUS:CANCELLED`) are left out. Two occurrences with the same `id` are
given once.

How a client shows an event on a day (all-day, single, first, middle or
last day of a multi-day event) and where it goes in Today's dayparts is
fixed by the conformance suite `today` (`eventSpan`, `eventsOnDay`,
`eventsByDaypart`).

**Fetching and freshness.** The server keeps each feed in memory for
**15 minutes** after a successful fetch; a request after that fetches it
again and waits for it. A failed fetch keeps the previous events and is
retried after **1 minute**. The cache is empty after a server restart. The
web app asks for today and the next 14 days, every 15 minutes (70 seconds
after an answer with a non-empty `failed`), on a new day and when it comes
back into view, and keeps the last answer per user to show offline.

---

## 3. Account and settings

### 3.1 The signed-in account

`GET /api/auth/me` (auth: user) is in protocol.md §10.5. The fields of
`user` that settings need:

| Field           | Type         | Meaning                                                                                                                           |
| --------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | Id           |                                                                                                                                   |
| `email`         | string       | A Home Assistant account has a placeholder ending in `@home-assistant.invalid`.                                                   |
| `createdAt`     | Instant      |                                                                                                                                   |
| `isAdmin`       | boolean      | Shows Administration (section 5).                                                                                                 |
| `homeAssistant` | boolean      | The account was made through Home Assistant's ingress.                                                                            |
| `hasPassword`   | boolean      | False for a Home Assistant account that has not set a password: it cannot sign in on the normal address until it sets one (§3.2). |
| `todaySeenOn`   | Date or null | The day "New in Today" was last dismissed (§3.4).                                                                                 |
| `twoStep`       | boolean      | Two-step verification is on.                                                                                                      |
| `blocked`       | boolean      | Always false here (a blocked account cannot sign in).                                                                             |

The same `user` object is the answer of signing in, registering and
signing in as a demo account.

### 3.2 `POST /api/auth/password`

Auth: session. Changes the password, or sets the first one for an account
without one.

```json
{ "currentPassword": "correct horse battery", "password": "a new longer password" }
```

| Field             | Rules                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `password`        | 8 to 1024 characters.                                                                              |
| `currentPassword` | 1 to 1024 characters. Required when the account has a password (`hasPassword`); ignored otherwise. |

**Response 200** `{"ok": true}`. Other sessions of the account, and its
agents' tokens, stay valid.

| Status | Body                                      | When                                                                                         |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body invalid.                                                                                |
| 400    | `{"error":"password_required"}`           | `currentPassword` missing on an account with a password.                                     |
| 401    | `{"error":"invalid_credentials"}`         | `currentPassword` is wrong.                                                                  |
| 429    | `{"error":"too_many_attempts"}`           | 10 wrong passwords for the account within 15 minutes (counted together with §3.3 `disable`). |

### 3.3 Two-step verification

Two-step verification is TOTP (RFC 6238: SHA-1, 6 digits, 30-second steps;
a code from the step before or after also counts, and every step counts
once). Turning it on takes two calls: `setup` gives a new secret, `enable`
confirms it with a code. Signing in with it is protocol.md §10.3.

All four endpoints: auth session.

#### `GET /api/auth/two-step`

```json
{ "enabled": true, "recoveryCodesLeft": 9 }
```

`recoveryCodesLeft` is 0 when two-step verification is off.

#### `POST /api/auth/two-step/setup`

No body. Makes a new secret and keeps it aside until `enable` confirms it.
Calling it again replaces the secret.

```json
{
  "secret": "QMIO7CH7U6RY5V4HASTLV4DHTZEOZFO3",
  "uri": "otpauth://totp/Dingen%3Abea%40example.com?secret=QMIO7CH7U6RY5V4HASTLV4DHTZEOZFO3&issuer=Dingen&algorithm=SHA1&digits=6&period=30"
}
```

`secret` is base32, for typing in by hand; `uri` is what a QR code holds.
Neither is shown again after `enable`. 409 `totp_already_enabled` when it is
already on.

#### `POST /api/auth/two-step/enable`

```json
{ "code": "492817" }
```

`code` 1 to 64 characters: a code from the authenticator app for the secret
of `setup`.

**Response 200**: the ten recovery codes, shown once. Each works once in
place of a code (protocol.md §10.3); spaces, dashes and case do not matter.
Turning it on again later makes new ones.

```json
{
  "recoveryCodes": [
    "32mp-bntp",
    "xa5q-uhch",
    "mwfn-yjrc",
    "nmbc-9tru",
    "8yv6-zm4z",
    "f343-ktdy",
    "j6wx-jkzm",
    "kku6-du4d",
    "u5g4-dzw9",
    "wrnj-x7du"
  ]
}
```

| Status | Body                                      | When                                              |
| ------ | ----------------------------------------- | ------------------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body invalid.                                     |
| 400    | `{"error":"totp_not_started"}`            | No `setup` before.                                |
| 400    | `{"error":"invalid_code"}`                | Wrong code. Try again with the same secret.       |
| 409    | `{"error":"totp_already_enabled"}`        | Already on.                                       |
| 429    | `{"error":"too_many_attempts"}`           | 10 wrong codes for the account within 15 minutes. |

#### `POST /api/auth/two-step/disable`

Turns it off with the account's password or a current code (a recovery
code also counts):

```json
{ "password": "correct horse battery" }
```

```json
{ "code": "492817" }
```

Each 1 to 1024 (`password`) or 1 to 64 (`code`) characters; one of the two
is required, `password` wins when both are given. **Response 200**
`{"ok": true}`; the secret and the recovery codes are removed.

| Status | Body                              | When                                                                                |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_body"}`        | Neither given, or malformed (no `issues`).                                          |
| 401    | `{"error":"invalid_credentials"}` | Wrong password.                                                                     |
| 401    | `{"error":"invalid_code"}`        | Wrong code, or two-step verification is off.                                        |
| 429    | `{"error":"too_many_attempts"}`   | 10 wrong passwords (with §3.2) or 10 wrong codes for the account within 15 minutes. |

With the password, a call while two-step verification is already off
answers 200.

### 3.4 `POST /api/auth/today-seen`

Auth: user. Stores the day "New in Today" was dismissed, on the account,
so every device knows.

```json
{ "date": "2026-11-26" }
```

`date` is a date. **Response 200** `{"ok": true}`; 400 `invalid_body` with
`issues` otherwise. The server stores the value as given; it does not
compare it with its own date. A token stores it for the agent's owner.

The day comes back as `user.todaySeenOn` from `GET /api/auth/me`. The web
app reads it at start and again when it comes back into view. Which tasks
count as new in Today is fixed by the conformance suite `today`
(`newInToday`).

### 3.5 Reminders on this device

There is no endpoint for native reminders: a native client plans them on
the device from the replica (the conformance suite `reminders`). The web
app's reminders use web push (section 6), which native clients do not use.

### 3.6 Tags

Tags are synced entities (entities.md); creating, renaming, nesting and
deleting them is done with sync. The tree, which parents a tag may get,
name checks and open-task counts are fixed by the conformance suite
`tag-tree`.

### 3.7 About

`GET /api/health` (protocol.md §11.1) gives the server's `version` and
`build`.

---

## 4. Agents, members and activity

### 4.1 Agents

An agent is a program the user lets work in their account with a bearer
token: what it may reach and at which level are its **grants**
(protocol.md §10.6). Agent management accepts only a session.

**Agent**

| Field         | Type            | Meaning                                                                                |
| ------------- | --------------- | -------------------------------------------------------------------------------------- |
| `id`          | Id              | The member id is `agent:<id>`.                                                         |
| `name`        | string          | 1 to 100 characters.                                                                   |
| `icon`        | icon id         |                                                                                        |
| `color`       | colour id       |                                                                                        |
| `createdAt`   | Instant         |                                                                                        |
| `lastUsedAt`  | Instant or null | The last request with its current token; `null` when the current token was never used. |
| `tokenPrefix` | string or null  | The first 10 characters of its token (`dgn_` and six more), to recognise it.           |
| `grants`      | Grant[]         | One per scope.                                                                         |

**Grant**: `{ "scope": "all" | "inbox", "level" }` or
`{ "scope": "area" | "project", "id", "level" }`, with `level` `read`,
`edit` or `manage`. `id` is an area or project id, 1 to 100 characters.
What each scope reaches is in protocol.md §10.6; the level an agent has on
an area or project is what `GET /api/access` answers.

When a request lists two grants for the same scope (and the same `id`), the
last one counts.

The MCP endpoint (`/mcp`) is where an agent connects; its address is the
server address followed by `/mcp`. The MCP protocol itself is outside this
file.

#### `GET /api/agents`

Auth: session. The live agents of the account, oldest first; revoked agents
are not listed.

```json
{
  "agents": [
    {
      "id": "01M8BRCFE9GVC3BMFN19VCVNWX",
      "name": "Claude",
      "icon": "bot",
      "color": "purple",
      "createdAt": "2026-11-26T11:03:23.337Z",
      "lastUsedAt": null,
      "tokenPrefix": "dgn_H8ChvH",
      "grants": [{ "scope": "area", "id": "01M8BRCEMB6FG3A28BJEM8ZQMP", "level": "edit" }]
    }
  ]
}
```

#### `POST /api/agents`

Auth: session. Makes an agent and its token.

```json
{
  "name": "Claude",
  "icon": "bot",
  "color": "purple",
  "grants": [{ "scope": "area", "id": "01M8BRCEMB6FG3A28BJEM8ZQMP", "level": "edit" }]
}
```

All four fields are required. `name` is trimmed, 1 to 100 characters;
`grants` at most 200 (it may be empty: the agent then reaches nothing).

**Response 201**: the agent and its token. The token is shown **only
here**; the server keeps only its hash.

```json
{
  "agent": { "id": "01M8BRCFE9GVC3BMFN19VCVNWX", "...": "..." },
  "token": "dgn_H8ChvHGPY1dElwTumdE2LWig9evCkKVMGXr11rtTbsE"
}
```

| Status | Body                                      | When                                                                                            |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body invalid (an unknown icon or colour included).                                              |
| 400    | `{"error":"invalid_grant"}`               | An `area` or `project` grant names an id that is not a live area or project the user can reach. |

#### `PATCH /api/agents/:id`

Auth: session. Every field of `POST` is optional here. `grants`, when
given, replaces all grants. The token does not change. **Response 200**
`{ "agent": Agent }`.

Errors: 400 `invalid_body` (with `issues`), 400 `invalid_grant`, 404
`not_found` (no live agent with this id for the user).

#### `POST /api/agents/:id/token`

Auth: session. No body. A new token for the agent; the old one stops
working at once. **Response 200** `{ "agent": Agent, "token": "dgn_…" }`,
as `POST /api/agents`. 404 `not_found`.

#### `DELETE /api/agents/:id`

Auth: session. Revokes the agent: its token stops working and it is no
longer listed or a member. Its past changes stay attributed to it
(`agent:<id>` as author and in activity); its tasks keep `assigneeId`.
**Response 200** `{"ok": true}`; 404 `not_found` when there is no live
agent with this id.

### 4.2 Members and access

`GET /api/members` and `GET /api/access` (both auth: user) are in
protocol.md §11.2 and §11.3. To change what an agent can reach on one area
or project (the web app's "Members" panel), a client changes that agent's
grants with `PATCH /api/agents/:id`, sending all of its grants.

Who can be assignee of a task (`Task.assigneeId`): the web app offers the
owner and the agents that `GET /api/access` lists for the task's project or
area (any level). The server checks this only on a push by an agent: it
refuses an `assigneeId` that is not a live member of the account or cannot
read the task.

### 4.3 `GET /api/activity`

Auth: user. The activity log (the web app's Logbook): what the user and
their agents did, newest first, in pages.

```
GET /api/activity?kinds=added,completed&actor=agent:01M8BRCFE9GVC3BMFN19VCVNWX&since=2026-11-01&until=2026-11-30T23:59:59Z&before=812&limit=50
```

| Parameter | Rules                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `kinds`   | Optional. Comma-separated kinds (table below); empty or absent is every kind.                         |
| `actor`   | Optional. A member id (`user:<id>`, `agent:<id>`) or `system`.                                        |
| `since`   | Optional. An ISO date or date-time; lines at or after it.                                             |
| `until`   | Optional. An ISO date or date-time; lines at or before it. A date alone is midnight UTC at its start. |
| `before`  | Optional. An integer ≥ 1: only lines older than this cursor. Pass the previous page's `nextBefore`.   |
| `limit`   | Optional. 1 to 100; default 50. The most lines on a page.                                             |

Invalid parameters: 400 `{"error":"invalid_query","issues":[...]}`.

**Response 200**

```json
{
  "items": [
    {
      "seq": 3,
      "at": "2026-11-26T11:03:23.370Z",
      "actor": "agent:01M8BRCENA3P858PZY09B0TPE9",
      "kind": "updated",
      "entityType": "task",
      "entityId": "01M8BRCFF0PY2NBV5XCD36E3PS",
      "title": "Write the API spec",
      "container": { "type": "area", "id": "01M8BRCEMB6FG3A28BJEM8ZQMP", "title": "Work" },
      "fields": [{ "field": "title", "from": "Write the spec", "to": "Write the API spec" }]
    }
  ],
  "nextBefore": 3
}
```

| Field        | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `items`      | The lines, newest first.                                                |
| `nextBefore` | Pass as `before` for the next page; `null` when there is nothing older. |

**Line**

| Field        | Type                                 | Meaning                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seq`        | integer                              | The `seq` of the newest change in the line. Unique per line; a key.                                                                                                                                                                                             |
| `at`         | Instant                              | When the server received the newest change in the line (not the device's clock).                                                                                                                                                                                |
| `actor`      | member id or `system`                | Who made the changes. A change without a recorded author counts as the user who pushed it.                                                                                                                                                                      |
| `kind`       | string                               | See below.                                                                                                                                                                                                                                                      |
| `entityType` | `task`, `project`, `area`, `heading` | Checklist items count for their task.                                                                                                                                                                                                                           |
| `entityId`   | Id                                   |                                                                                                                                                                                                                                                                 |
| `title`      | string                               | The entity's **current** title, not the one at the time; `""` when it has none.                                                                                                                                                                                 |
| `container`  | object or null                       | Where the entity is now: `{type: "project" or "area", id, title}`. A task: its project (directly or through its heading), else its area. A project: its area. A heading: its project. An area: `null`. Also `null` for an agent that cannot read the container. |
| `fields`     | array                                | `{field, from, to}` per changed field; see below.                                                                                                                                                                                                               |

**Kinds**, decided from the line's changes in this order:

| Kind        | When                                                  | `fields`                                                         |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `deleted`   | `deleted` is true after the line.                     | `[]`                                                             |
| `added`     | The line holds the entity's creation.                 | `[]`                                                             |
| `reopened`  | `status` changed to `open`.                           | `[]`                                                             |
| `completed` | `status` changed to `completed` or `canceled`.        | `[{field: "status", from: null, to: "completed" \| "canceled"}]` |
| `moved`     | The entity moved to another space (protocol.md §6.4). | `[{field: "space", from: null, to: "personal" \| "shared"}]`     |
| `updated`   | Anything else.                                        | The changed fields.                                              |

For `updated`, `fields` lists every changed field with its value before
the line (`from`) and after it (`to`), as entity values (entities.md). Left
out: `id`, `createdAt`, `completedAt`, `deleted` true, `status`, and fields
whose value did not change. `order` and `todayOrder` are only listed when
nothing else changed. A restore from the trash is `{field: "deleted",
from: true, to: false}`. Notes and checklists only say that they changed:
`{field: "notes"}` and `{field: "checklist"}` have `from` and `to` null. A
field that had no value before has `from` null. An `updated` line with no
fields left is not given.

**What makes a line.** Lines are made from the change log of the user's
spaces. Consecutive changes (in `seq` order) to one entity by one actor
fold into one line when each is at most **5 minutes** after the one before
and the line spans at most **60 minutes**; a creation always starts a new
line. Not in the log: repeat templates and their checklist items, the
rows the server writes along with a move between spaces, and entities that
are no longer in the user's spaces (moved out with all their history).

**Paging.** Pages cut cleanly between lines, so the pages together give
exactly the lines of the whole log. One request reads at most 5000 log
rows: with narrow filters a page can come back with fewer than `limit`
lines, or none, and a non-null `nextBefore`. Ask again from there until
`nextBefore` is null or the page is full. With `since`, the server stops
reading at the first change older than it.

**For an agent token**, only lines of entities the agent can read are
given (protocol.md §10.6), and `container` is `null` when it cannot read
that.

To show the newest lines after a sync, a client asks the first page again.

---

## 5. Administration and data

### 5.1 Creating an account

`GET /api/auth/status` (auth: none) is in protocol.md §10.5. It tells a
sign-in screen what to offer: register (`registrationOpen`, or
`registration` `"invite"` with an invitation), "forgot password"
(`passwordReset`) and demo accounts (`demo`).

#### `POST /api/auth/register`

Auth: none. Makes an account and signs it in.

```json
{
  "email": "cas@example.com",
  "password": "correct horse battery",
  "invite": "fo7hE_eLn5cdasHP0Rm7MxA3ecfusdI1OV8duClngxQ"
}
```

| Field      | Rules                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `email`    | A valid address, at most 254 characters. Stored trimmed and in lower case.                        |
| `password` | 8 to 1024 characters.                                                                             |
| `invite`   | 1 to 200 characters. The secret from an invitation link; only used when registration is `invite`. |

Who may register: the first account on a server always, and it becomes
administrator. After that it depends on the registration mode (§5.4):
`open` anyone, `invite` with an open invitation, `closed` nobody. Using an
invitation marks it used in the same step, so one link makes one account.
Every new account gets its own personal space.

**Response 201**: a session is set as a cookie, as with signing in
(protocol.md §10.4). Body `{ "user": User }` (§3.1).

| Status | Body                                      | When                                                |
| ------ | ----------------------------------------- | --------------------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body invalid.                                       |
| 409    | `{"error":"email_taken"}`                 | An account with this address exists. Checked first. |
| 401    | `{"error":"registration_closed"}`         | Registration is `closed`.                           |
| 403    | `{"error":"invite_required"}`             | Registration is `invite` and no `invite` was given. |
| 403    | `{"error":"invite_invalid"}`              | No invitation with this secret.                     |
| 403    | `{"error":"invite_expired"}`              | The invitation is older than 14 days.               |
| 403    | `{"error":"invite_used"}`                 | Already used.                                       |
| 403    | `{"error":"invite_revoked"}`              | Withdrawn by an administrator.                      |

#### `GET /api/auth/invite/:token`

Auth: none. Checks an invitation before the form is filled in. `:token` is
the secret from the link.

**Response 200** `{ "ok": true, "expiresAt": "2026-12-10T11:03:23.394Z" }`.

| Status | Body                         | When                |
| ------ | ---------------------------- | ------------------- |
| 404    | `{"error":"invite_invalid"}` | Unknown secret.     |
| 410    | `{"error":"invite_expired"}` | Older than 14 days. |
| 410    | `{"error":"invite_used"}`    | Already used.       |
| 410    | `{"error":"invite_revoked"}` | Withdrawn.          |

**The link.** An invitation link is `<server>/?invite=<secret>` (the web
app makes it from the secret; the server only hands out the secret). A
native client that accepts a pasted link reads the `invite` query
parameter.

### 5.2 Forgotten passwords

#### `POST /api/auth/forgot`

Auth: none. Mails a reset link when the address has an account. Only
works when `GET /api/auth/status` has `passwordReset: true`.

```json
{ "email": "cas@example.com", "language": "nl" }
```

`email` at most 254 characters (not checked as an address). `language` at
most 35 characters, the language of the mail: Dutch when it is `nl` or
starts with `nl-`, else English. Without it the first language of the
`Accept-Language` header decides.

**Response 200** `{"ok": true}`, the same whether or not the address has an
account, and sent before the mail goes out. No mail is sent to an unknown
address, a blocked account, a Home Assistant account, or for more than 3
requests for one address within an hour (the answer stays the same).

| Status | Body                                      | When                                                                                                             |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 404    | `{"error":"mail_not_configured"}`         | The server has no outgoing mail.                                                                                 |
| 404    | `{"error":"public_url_not_set"}`          | The server has no `DINGEN_PUBLIC_URL` to put in the link.                                                        |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body invalid.                                                                                                    |
| 429    | `{"error":"too_many_attempts"}`           | More than 10 requests from this client address within an hour (protocol.md §10.2 says how the address is known). |

The link in the mail is `<DINGEN_PUBLIC_URL>/?reset=<secret>`, valid for
**one hour**. It opens the web app.

#### `GET /api/auth/reset/:token` and `POST /api/auth/reset`

Auth: none. Choosing a new password from a reset link; the web app does
this. `GET` checks the link: **200** `{ "ok": true, "expiresAt": Instant }`.
`POST` sets the password:

```json
{ "token": "Ck_Fb4Jitc5n_7vdxKbodvtdqB4Ta7iLatDo86a9fzA", "password": "a new longer password" }
```

`token` 1 to 200 characters, `password` 8 to 1024. **200** `{"ok": true}`.
Using a link closes every other open link of the account and **signs out
all its sessions**; agents' tokens keep working.

| Status | Body                                      | When                                   |
| ------ | ----------------------------------------- | -------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | `POST` only: body invalid.             |
| 404    | `{"error":"reset_invalid"}`               | Unknown link.                          |
| 410    | `{"error":"reset_expired"}`               | Past its lifetime.                     |
| 410    | `{"error":"reset_used"}`                  | Used, or closed by using another link. |
| 403    | `{"error":"account_blocked"}`             | The account is blocked.                |

### 5.3 Demo accounts

Only on a demo server (`GET /api/auth/status` has `demo: true`); elsewhere
both answer 404 `not_found`. Auth: none.

`GET /api/auth/demo` lists the demo accounts that exist:

```json
{
  "accounts": [
    { "email": "sam@example.com", "name": "Sam Rivera", "description": "freelance web designer" }
  ]
}
```

`POST /api/auth/demo/:email` signs in as one without a password: a session
cookie and `{ "user": User }`, as with signing in. 404 `not_found` for an
address that is not a demo account; 403 `account_blocked`.

### 5.4 Registration mode

Who may create an account besides the first: `closed` (nobody), `invite`
(with an invitation) or `open` (anyone). `DINGEN_REGISTRATION` is only the
starting value; after that the administrator decides.

- `GET /api/admin/registration` (auth: admin): `{ "mode": "invite" }`.
- `PUT /api/admin/registration` (auth: admin), body `{ "mode": "open" }`:
  **200** `{ "mode": "open" }`; 400 `invalid_body` with `issues`.

The change is immediate; open invitations stay open in every mode but only
count in `invite`.

### 5.5 Invitations

An invitation is a one-time secret that lets one person register while the
mode is `invite`. It is valid for **14 days**.

**Invitation**

| Field       | Type            | Meaning                                                                               |
| ----------- | --------------- | ------------------------------------------------------------------------------------- |
| `id`        | Id              |                                                                                       |
| `createdAt` | Instant         |                                                                                       |
| `expiresAt` | Instant         | `createdAt` plus 14 days.                                                             |
| `createdBy` | string or null  | The email address of the administrator who made it; `null` when that account is gone. |
| `usedAt`    | Instant or null |                                                                                       |
| `usedBy`    | string or null  | The email address of the account made with it.                                        |
| `revokedAt` | Instant or null |                                                                                       |
| `status`    | string          | `used`, else `revoked`, else `expired`, else `open` (checked in that order).          |

#### `GET /api/invitations`

Auth: admin, everything:manage. Every invitation of the server, newest
first: `{ "invitations": [Invitation] }`.

#### `POST /api/invitations`

Auth: admin, session. No body. **Response 201**: the secret, shown only
here, and the invitation. The link to hand out is `<server>/?invite=<token>`.

```json
{
  "token": "fo7hE_eLn5cdasHP0Rm7MxA3ecfusdI1OV8duClngxQ",
  "invitation": {
    "id": "01M8BRCFG2KZ3XR428R81XPH1Q",
    "createdAt": "2026-11-26T11:03:23.394Z",
    "expiresAt": "2026-12-10T11:03:23.394Z",
    "createdBy": "admin@example.com",
    "usedAt": null,
    "usedBy": null,
    "revokedAt": null,
    "status": "open"
  }
}
```

#### `DELETE /api/invitations/:id`

Auth: admin, session. Withdraws an invitation that is not used yet.
**200** `{"ok": true}` (also when it was withdrawn or expired already); 404
`not_found`; 409 `already_used`.

### 5.6 Users

All of `/api/admin` (§5.4, §5.6–§5.8) has auth **admin**: an administrator
with a session.

**Admin user**

| Field           | Type            | Meaning                                                      |
| --------------- | --------------- | ------------------------------------------------------------ |
| `id`            | Id              |                                                              |
| `email`         | string          |                                                              |
| `createdAt`     | Instant         |                                                              |
| `isAdmin`       | boolean         |                                                              |
| `blockedAt`     | Instant or null | When it was blocked.                                         |
| `lastActiveAt`  | Instant or null | The latest use of a session or of one of its agents' tokens. |
| `homeAssistant` | boolean         |                                                              |
| `hasPassword`   | boolean         |                                                              |
| `totpEnabled`   | boolean         | Two-step verification is on.                                 |

#### `GET /api/admin/users`

Every account, oldest first: `{ "users": [AdminUser] }`.

#### `PATCH /api/admin/users/:id`

Makes or unmakes an administrator, blocks or unblocks.

```json
{ "isAdmin": true, "blocked": false }
```

Both optional; at least one. When both are given, `blocked` is applied
first: if `isAdmin` then fails, the block has already happened.
**Response 200** `{ "user": AdminUser }`.

Blocking ends the account's sessions at once. Its agents' tokens are
refused while it is blocked and work again after unblocking. A blocked
account cannot sign in (`account_blocked`) and its reset links do not work.

| Status | Body                                      | When                                                                                                                                                        |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body invalid or empty.                                                                                                                                      |
| 404    | `{"error":"not_found"}`                   | No such account.                                                                                                                                            |
| 409    | `{"error":"self"}`                        | Blocking oneself or taking away one's own administrator rights.                                                                                             |
| 409    | `{"error":"last_admin"}`                  | It would leave no unblocked administrator. (Over HTTP the acting administrator always remains, so this does not occur; it guards the server's other paths.) |

#### `DELETE /api/admin/users/:id`

Deletes a **blocked** account with all its data. The body confirms it:

```json
{ "confirm": "cas@example.com" }
```

`confirm` 1 to 254 characters: the account's email address (trimmed, case
ignored). A back-up (`pre-delete`) is made first when the server keeps
back-ups. Deleted: the account, its personal space and the shared spaces it
owns with their entities and change log, its sessions, agents, calendars,
push subscriptions and the invitations it made. Changes it made in other
people's spaces stay.

**Response 200**

```json
{ "ok": true, "backup": "dingen-pre-delete-2026-11-26T110323Z-0014.db", "spaces": 1, "entities": 0 }
```

`backup` is the back-up's name, or `null` without back-ups; `spaces` and
`entities` count what was removed.

| Status | Body                                      | When                                           |
| ------ | ----------------------------------------- | ---------------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body invalid.                                  |
| 404    | `{"error":"not_found"}`                   | No such account.                               |
| 409    | `{"error":"self"}`                        | One's own account.                             |
| 409    | `{"error":"not_blocked"}`                 | The account is not blocked.                    |
| 400    | `{"error":"confirm_mismatch"}`            | `confirm` is not the account's address.        |
| 409    | `{"error":"shared_space"}`                | It owns a shared space that has other members. |

#### `POST /api/admin/users/:id/reset-link`

No body. A one-time reset link for the administrator to pass on by hand,
valid for **24 hours**.

```json
{
  "token": "Ck_Fb4Jitc5n_7vdxKbodvtdqB4Ta7iLatDo86a9fzA",
  "url": "https://dingen.example.com/?reset=Ck_Fb4Jitc5n_7vdxKbodvtdqB4Ta7iLatDo86a9fzA",
  "expiresAt": "2026-11-27T11:03:23.532Z"
}
```

**Response 201**. `url` uses `DINGEN_PUBLIC_URL`, else the address the
request came in on. 404 `not_found`; 409 `account_blocked`.

#### `POST /api/admin/users/:id/totp/disable`

No body. Turns off the account's two-step verification (also one's own).
**200** `{"ok": true}`, also when it was off; 404 `not_found`.

### 5.7 Back-ups

Back-ups are SQLite files in the server's `DATA_DIR/backups`. On a server
without a back-up directory every back-up endpoint answers 404
`not_found`.

**Back-up**

| Field    | Type    | Meaning                                                                                    |
| -------- | ------- | ------------------------------------------------------------------------------------------ |
| `name`   | string  | The file name, e.g. `dingen-manual-2026-11-26T110323Z-0014.db`. Use it in the paths below. |
| `kind`   | string  | `daily`, `pre-update`, `pre-restore`, `pre-delete` or `manual`.                            |
| `at`     | Instant | When it was made (whole seconds).                                                          |
| `schema` | string  | The database schema version in it (`0014`).                                                |
| `size`   | integer | Bytes.                                                                                     |

- `GET /api/admin/backups`: `{ "backups": [Backup], "canRestore": true }`,
  newest first. `canRestore` is false when this server cannot restore
  (then the restore endpoint answers 404).
- `POST /api/admin/backups`, no body: makes a `manual` back-up now.
  **201** `{ "backup": Backup }`. Older back-ups are then thinned out
  (manual ones are never removed).
- `GET /api/admin/backups/:name`: the file itself. **200** with
  `content-type: application/vnd.sqlite3`, `content-length`,
  `content-disposition: attachment; filename="<name>"`. 404 `not_found` for
  a name that is not a back-up.
- `POST /api/admin/backups/:name/restore`, no body: puts the back-up in
  place of the live database.

**Restore.** The server first checks that the file is a Dingen database it
can run, then makes a `pre-restore` back-up of the live database, answers,
and then swaps the database and starts again in the same process
(migrations included).

**Response 202** `{ "ok": true, "saved": "dingen-pre-restore-2026-11-26T110323Z-0014.db" }`.

| Status | Body                                        | When                                                                             |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------- |
| 404    | `{"error":"not_found"}`                     | No such back-up, or the server cannot restore.                                   |
| 422    | `{"error":"invalid_backup","issues":[...]}` | Not a Dingen database this version can run. `issues` is one sentence in English. |

While it restarts, every request answers 503 `restarting` (§1.1); poll
`GET /api/health` until it answers 200. If the restored database cannot
start, the server puts the saved one back. The administrator who asked
stays signed in when their account is in the back-up and not blocked
(with a new 30-day lifetime); every other session is whatever the back-up
holds. What a restore does to sync is in protocol.md §9.5.

### 5.8 Mail

- `GET /api/admin/mail`: `{ "configured": true, "from": "Dingen <dingen@example.com>" }`.
  `from` is `null` without mail. Mail is set up on the server (`SMTP_*`),
  not through the API.
- `POST /api/admin/mail/test`: sends a test mail to the administrator's own
  address. Optional body `{ "language": "nl" }` (at most 35 characters; a
  malformed body is ignored, `Accept-Language` decides then). **200**
  `{ "ok": true, "to": "admin@example.com" }`.

| Status | Body                                                    | When                                             |
| ------ | ------------------------------------------------------- | ------------------------------------------------ |
| 409    | `{"error":"mail_not_configured"}`                       | No mail set up.                                  |
| 502    | `{"error":"mail_failed","detail":"connection refused"}` | The mail server refused or could not be reached. |

### 5.9 Export

#### `GET /api/export`

Auth: everything:read. Everything the user owns as one JSON file: the
live (not deleted) entities of their personal space and of the shared
spaces they made (not of spaces where they are only a member).

**Response 200** with `content-disposition: attachment;
filename="dingen-export-<YYYY-MM-DD>.json"`:

```json
{
  "format": "dingen-export",
  "version": 3,
  "appVersion": "1.0.0-beta.2",
  "exportedAt": "2026-11-26T11:03:23.811Z",
  "spaces": [{ "id": "01M8BRCEGFPRFWE6C9JPDJGEM6", "kind": "personal" }],
  "entities": {
    "area": [
      {
        "id": "01M8BRCEMB6FG3A28BJEM8ZQMP",
        "spaceId": "01M8BRCEGFPRFWE6C9JPDJGEM6",
        "data": { "id": "01M8BRCEMB6FG3A28BJEM8ZQMP", "title": "Work", "...": "..." },
        "fieldTs": { "title": "001795691002507:00000:CONTRACT", "...": "..." }
      }
    ],
    "project": [],
    "heading": [],
    "task": [],
    "checklistItem": [],
    "tag": []
  }
}
```

| Field        | Meaning                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`     | Always `"dingen-export"`.                                                                                                                                                                                             |
| `version`    | The file format, now **3**.                                                                                                                                                                                           |
| `appVersion` | The server version that wrote it.                                                                                                                                                                                     |
| `spaces`     | `{id, kind}` of the spaces in the file, the personal space first.                                                                                                                                                     |
| `entities`   | Per entity type (in this order), the records sorted by id. A record is `{id, spaceId, data, fieldTs}`: `data` is the entity (entities.md), `fieldTs` the timestamp of every field in it except `id` (protocol.md §4). |

### 5.10 Import

#### `POST /api/import?mode=merge|reject`

Auth: everything:manage. Reads an export file (the body, at most **50
MB**) into the account.

`mode` is `merge` (default) or `reject`. With `reject` the import is
refused when the account already has any live entity.

The server accepts format versions 1, 2 and 3. Version 1 has no `spaces`
and no `spaceId`. Versions 1 and 2 have tasks with `evening` and `time`,
which are turned into `daypart`, `duration` and a reminder as the server's
own data migration does. An `entities.review` list (from files before
1.0.0-beta.1) is accepted and ignored. Tag titles are lowercased.

The whole file is checked before anything is written: `data.id` must equal
`id`, `data` must be a valid entity with no unknown field, every field in
`data` except `id` needs a timestamp in `fieldTs`, no id twice per type, no
space id twice, at most one personal space, and every `spaceId` must be in
`spaces`.

How each record lands:

- Each field is merged with "last writer wins" on its timestamp
  (protocol.md §4.3), as if the file's fields were pushed as changes. An
  entity the user already has is merged into; a change the server already
  has is not applied twice. The author of the changes is the caller
  (`user:<id>` or `agent:<id>`).
- An entity that exists in a space the user may not write, or in someone
  else's space, is skipped.
- A new entity goes to its `spaceId` when the user can write there. A
  `personal` space from the file maps to the user's own personal space. A
  `shared` space that does not exist on this server is created with the
  same id, owned by the user. Otherwise the entity goes where a new entity
  would go (protocol.md §6.3).
- Afterwards tags in one space with the same name become one tag.

**Response 200**

```json
{
  "mode": "merge",
  "counts": {
    "area": { "created": 0, "updated": 0, "unchanged": 1, "skipped": 0 },
    "project": { "created": 0, "updated": 0, "unchanged": 0, "skipped": 0 },
    "heading": { "created": 0, "updated": 0, "unchanged": 0, "skipped": 0 },
    "task": { "created": 0, "updated": 0, "unchanged": 1, "skipped": 0 },
    "checklistItem": { "created": 0, "updated": 0, "unchanged": 0, "skipped": 0 },
    "tag": { "created": 0, "updated": 0, "unchanged": 0, "skipped": 0 }
  },
  "total": { "created": 0, "updated": 0, "unchanged": 2, "skipped": 0 },
  "seq": 3
}
```

`counts` per entity type, `total` summed; `seq` is the last `seq` of the
change log after the import. The imported changes reach clients through
the normal pull; a client syncs after an import.

| Status | Body                                        | When                                                                          |
| ------ | ------------------------------------------- | ----------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_mode"}`                  | `mode` is not `merge` or `reject`.                                            |
| 400    | `{"error":"invalid_export","issues":[...]}` | Not a valid export file. `issues` are up to 20 strings `"<path>: <problem>"`. |
| 409    | `{"error":"account_not_empty"}`             | `mode=reject` and the account has live entities.                              |
| 413    | `{"error":"too_large"}`                     | Body over 50 MB.                                                              |
| 403    | `{"error":"space_access","message":"..."}`  | A record would have to be written in a space the user cannot write.           |

The whole import is one transaction: on an error nothing is written.

### 5.11 Importers

Importing from TickTick, Todoist and a generic CSV is not an endpoint: it
is the command-line tool `dingen-import` (`packages/mcp`), which reads the
file and writes through sync with an agent token. A native client needs
nothing from the server for it.

---

## 6. Web push (not for native clients)

The web app's reminders and "assigned to you" notices are Web Push
messages (VAPID). Native clients plan reminders on the device (§3.5) and do
not use these endpoints; they are listed so the API is complete. Auth for
all four: everything:read.

| Endpoint                         | Body                                                 | Answer                                      |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `GET /api/push/key`              | —                                                    | 200 `{ "publicKey": "<VAPID public key>" }` |
| `POST /api/push/subscriptions`   | `{ endpoint, keys: { p256dh, auth }, language? }`    | 201 `{"ok": true}`                          |
| `DELETE /api/push/subscriptions` | `{ endpoint }`                                       | 200 `{"ok": true}`                          |
| `POST /api/push/test`            | `{ title?, body? }` (at most 200 and 500 characters) | 200 `{ "sent": <count> }`                   |

`endpoint` must be an `https` address of at most 2048 characters; the keys
1 to 512 characters. An invalid body is 400 `invalid_body` without
`issues`.

---

## 7. Error codes

Every `error` value outside sync, with its status and where it comes from.
The codes of signing in and sync are in protocol.md §7 and §10.

| `error`                | Status   | Endpoints                                                                  |
| ---------------------- | -------- | -------------------------------------------------------------------------- |
| `account_blocked`      | 403, 409 | reset link check and use (403); demo sign-in (403); admin reset link (409) |
| `account_not_empty`    | 409      | import                                                                     |
| `agent_scope`          | 403      | any, §1.2                                                                  |
| `already_used`         | 409      | withdraw invitation                                                        |
| `confirm_mismatch`     | 400      | delete user                                                                |
| `email_taken`          | 409      | register                                                                   |
| `feed_invalid`         | 400      | add calendar                                                               |
| `feed_too_large`       | 400      | add calendar                                                               |
| `feed_unreachable`     | 400      | add calendar                                                               |
| `forbidden`            | 403      | administration and invitations, §1.2                                       |
| `internal`             | 500      | any                                                                        |
| `invalid_backup`       | 422      | restore                                                                    |
| `invalid_body`         | 400      | any endpoint with a body                                                   |
| `invalid_code`         | 400, 401 | two-step enable (400), disable (401)                                       |
| `invalid_credentials`  | 401      | password, two-step disable                                                 |
| `invalid_export`       | 400      | import                                                                     |
| `invalid_grant`        | 400      | create and change agent                                                    |
| `invalid_mode`         | 400      | import                                                                     |
| `invalid_query`        | 400      | activity, access                                                           |
| `invalid_range`        | 400      | calendar events                                                            |
| `invalid_url`          | 400      | add calendar                                                               |
| `invite_expired`       | 403, 410 | register (403), invite check (410)                                         |
| `invite_invalid`       | 403, 404 | register (403), invite check (404)                                         |
| `invite_required`      | 403      | register                                                                   |
| `invite_revoked`       | 403, 410 | register (403), invite check (410)                                         |
| `invite_used`          | 403, 410 | register (403), invite check (410)                                         |
| `last_admin`           | 409      | change user                                                                |
| `mail_failed`          | 502      | test mail                                                                  |
| `mail_not_configured`  | 404, 409 | forgot password (404), test mail (409)                                     |
| `not_blocked`          | 409      | delete user                                                                |
| `not_found`            | 404      | unknown path or id, §1.3                                                   |
| `password_required`    | 400      | password                                                                   |
| `public_url_not_set`   | 404      | forgot password                                                            |
| `registration_closed`  | 401      | register                                                                   |
| `reset_expired`        | 410      | reset link check and use                                                   |
| `reset_invalid`        | 404      | reset link check and use                                                   |
| `reset_used`           | 410      | reset link check and use                                                   |
| `restarting`           | 503      | any, during a restore                                                      |
| `self`                 | 409      | change and delete user                                                     |
| `session_required`     | 403      | any session-only endpoint, §1.2                                            |
| `shared_space`         | 409      | delete user                                                                |
| `space_access`         | 403      | import                                                                     |
| `too_large`            | 413      | import                                                                     |
| `too_many_attempts`    | 429      | password, two-step enable and disable, forgot password                     |
| `totp_already_enabled` | 409      | two-step setup and enable                                                  |
| `totp_not_started`     | 400      | two-step enable                                                            |
| `unauthorized`         | 401      | any, §1.2                                                                  |

---

## 8. Open points

Things a native client needs that the server does not offer today, as
facts. The open points of the sync protocol (protocol.md §12) also apply.

1. **No author in pull answers.** A change in a pull answer carries no
   member id. A client cannot tell that an agent assigned a task to the
   user (the server only tells by web push, section 6) nor show who changed
   something; only `GET /api/activity` gives authors, per line.
2. **Web push only.** Reminders and "assigned to you" are sent as Web Push
   (VAPID) to browser subscriptions. There is no registration for platform
   push services (FCM, APNs, UnifiedPush), so a native client cannot be
   told about an assignment while it is not running.
3. **Calendar events in the server's time zone.** `from`, `to` and the days
   and clock times of events are in `DINGEN_TIMEZONE`, not the device's.
   There is no parameter for the device's zone.
4. **Calendar feeds are cached in memory only.** After a server restart a
   feed that cannot be fetched is in `failed` and has no events until a
   fetch succeeds; clients keep their own copy to show offline.
5. **No server-side review.** Which items are due for review is worked
   out by each client from the replica; the server has no endpoint for it.
6. **Links in mail open the web app.** Reset links (`?reset=`) and
   invitation links (`?invite=`) point to the server's web address. There
   is no scheme or path a native app can register to open them itself.
7. **Validation `issues` are not a contract.** Their shape follows the
   server's validation library, and some import issues are written in
   Dutch (`dubbel id`, `onbekende ruimte`, `tijdstempel voor … ontbreekt`).
8. **The 2xx answers of `DELETE /api/invitations/:id` and of turning off
   two-step verification do not say whether anything changed** (already
   withdrawn, already off).
9. **No endpoint to list or end other sessions** of the account, for
   example after changing the password (protocol.md §12.3). Changing the
   password keeps every session; only a reset link signs them all out.
10. **`last_admin` cannot be reached over HTTP.** The guard exists, but the
    administrator making the request always counts as another unblocked
    administrator.
11. **No streaming for activity.** New lines are found by asking for the
    first page again; there is no cursor that gives only lines newer than
    a known one.
