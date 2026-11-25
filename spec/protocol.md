# Dingen sync protocol

Protocol version 4. This file describes how a client talks to a Dingen
server: identifiers, timestamps, changes, ordering, spaces, the sync
endpoints, the client algorithm, signing in and the other endpoints a
daily-use client needs. It is written so that a client can be built
without reading the server or web app source.

Entity types and their fields are listed in [entities.md](entities.md);
the test set a client must pass is in [conformance/](conformance/README.md). This file
only names fields where the protocol depends on them.

The words "must", "must not" and "may" are normative.

## Contents

1. [Overview](#1-overview)
2. [Identifiers](#2-identifiers)
3. [Timestamps (hybrid logical clock)](#3-timestamps-hybrid-logical-clock)
4. [Changes](#4-changes)
5. [Ordering](#5-ordering)
6. [Spaces](#6-spaces)
7. [Sync endpoints](#7-sync-endpoints)
8. [Client algorithm](#8-client-algorithm)
9. [What the server does on its own](#9-what-the-server-does-on-its-own)
10. [Signing in](#10-signing-in)
11. [Other endpoints](#11-other-endpoints)
12. [Open points](#12-open-points)

---

## 1. Overview

### 1.1 Model

Dingen is offline-first. Every client keeps a full local replica of the
data the user can see. The user works against that replica; the network is
only used to exchange changes.

- Every edit is a **change**: a set of field values for one entity, stamped
  with a hybrid logical clock timestamp (section 3).
- A client stores its own changes in a local **queue** (outbox) until the
  server has accepted them.
- The server keeps a **change log** per space. Each stored change gets a
  `seq`: one counter for the whole server, strictly increasing.
- Conflicts are resolved **per field, last writer wins**: for every field
  the value with the highest timestamp wins. Every client and the server
  apply the same rule, so they converge without asking each other.
- Nothing is ever physically deleted through the protocol. A deletion is the
  field `deleted` set to `true` (a tombstone).

A sync round is: push the queue, then pull what is new.

### 1.2 Protocol version and header

The current protocol is **4**. The server accepts protocol 4 and newer.

Every request to `/api/sync/*` must carry the header:

```
x-dingen-protocol: 4
```

The value must be a decimal integer. A request without the header, or with
a value below 4, is refused with HTTP 426 (section 7.5). A client may send
the header on every request; other endpoints ignore it.

`GET /api/health` reports the protocol the server speaks as `syncProtocol`
(section 11.1).

### 1.3 Compatibility promise

From 1.0.0-beta.1 until Dingen 2.0 the protocol only grows. The server's
contract test pins the shapes and allows only these changes:

- a new optional field with a default, in an entity or in an answer;
- a new entity type;
- a looser check.

Fields and entity types are never renamed or removed, never made required
or stricter, and never change meaning. The protocol number stays 4 until
2.0.

What this means for a client:

- A client must ignore fields it does not know, in entities and in answers.
- A client must ignore entity types it does not know (in `changes`,
  `entities` and `arrived`). It must still advance its cursor past them.
- A client must keep fields it does not know in its local record (store
  `data` and `fieldTs` as open maps, not only as typed structures). It must
  never send a field it did not change; that way fields from a newer server
  survive a round trip.
- A field with a default may be missing from `data`. Records written before
  the field existed, and creates that left it out, do not have it. A client
  must read a missing field as its default (`spec/entities.md` lists the
  defaults).
- A `task` record may still carry the retired fields `evening` and `time`
  from protocol 2. A client must ignore them and must not send them.

---

## 2. Identifiers

### 2.1 ULID

Every entity id and every change id is a ULID: 26 characters from the
Crockford base 32 alphabet

```
0123456789ABCDEFGHJKMNPQRSTVWXYZ
```

(no `I`, `L`, `O`, `U`; upper case only). The server checks ids against the
pattern

```
^[0-9A-HJKMNP-TV-Z]{26}$
```

A client must generate ids like this:

1. Take the current time in milliseconds since the Unix epoch.
2. Encode it as 10 characters, most significant first: repeat 10 times
   `char = ALPHABET[t mod 32]`, prepend it, `t = floor(t / 32)`.
3. Take 16 random bytes from a cryptographically secure source. For each
   byte append `ALPHABET[byte mod 32]`.
4. The id is the 10 time characters followed by the 16 random characters.

Example: `01M83XJA6GPT2FAVXC6RP7S4X3`.

A client must treat ids as opaque strings. Ids the server makes itself (for
rows written along with a move, section 9.3) match the pattern but do not
encode a time. A client must not derive a time from an id.

### 2.2 Client id

Each installation of a client has a **client id**: a short random string
that goes into every timestamp it makes (section 3). Generate it once, store
it with the replica, and keep it for the life of that replica:

1. Take 8 random bytes from a cryptographically secure source.
2. For each byte append `ALPHABET[byte mod 32]` (the alphabet above).

Example: `7K2M9QXA`.

Constraints: the client id must only contain `0-9` and `A-Z` (it is part of
the timestamp pattern, section 3.1) and must be 1 to 64 characters. Two
clients must not share a client id; a new replica (reinstall, new account
on the device) must get a new one.

### 2.3 Space ids and member ids

- **Space ids** are strings of 1 to 64 characters. A personal space id is a
  ULID; a shared space created by an import keeps the id from the export
  file. A client must treat space ids as opaque.
- **Member ids** name a person or an agent: `user:<userId>` or
  `agent:<agentId>`. They appear as `Task.assigneeId`, in `/api/members`
  and in `/api/auth/me`.

---

## 3. Timestamps (hybrid logical clock)

### 3.1 Format

A timestamp is a string of three parts joined by `:`:

```
<wall>:<counter>:<clientId>
```

- `wall`: milliseconds since the Unix epoch, decimal, left-padded with `0`
  to exactly **15** digits.
- `counter`: decimal, left-padded with `0` to exactly **5** digits.
- `clientId`: the client id of the client that made the timestamp.

Pattern (checked by the server):

```
^\d{15}:\d{5}:[0-9A-Z]+$
```

Example: `001795428000000:00000:7K2M9QXA`.

The counter must not exceed `99999`; a six-digit counter does not match the
pattern and the push is refused. (The reference implementation does not
guard against this; in practice the counter resets every millisecond.)

### 3.2 Comparison

Timestamps compare as **plain strings**, character by character on the
character code (ordinal comparison). Thanks to the fixed padding this gives
the clock order: wall time first, then counter, then client id. Because
every client has its own id, two different clients never produce equal
timestamps.

A client must use ordinal comparison. Locale-aware or culture-aware string
comparison (for example the default `string.Compare` in C#) gives wrong
results.

### 3.3 Clock state and `now`

The clock holds two numbers, `lastWall` and `counter`, both starting at 0,
plus the client id.

`now()` returns a timestamp for a local change:

1. `wall = current time in milliseconds`.
2. If `wall > lastWall`: set `lastWall = wall` and `counter = 0`.
3. Else: `counter = counter + 1`.
4. Return `format(lastWall, counter, clientId)`.

Each call returns a timestamp strictly greater than every earlier one from
this clock, also when the system clock goes backwards.

### 3.4 `receive`

`receive(remote)` takes a timestamp seen from elsewhere, so that later local
timestamps sort after it:

1. Parse `remote` into `remoteWall` and `remoteCounter` (split on `:`, parse
   the first two parts as integers).
2. `wall = current time in milliseconds`.
3. `maxWall = max(wall, lastWall, remoteWall)`.
4. Then, in this order:
   - if `maxWall == lastWall` and `maxWall == remoteWall`:
     `counter = max(counter, remoteCounter) + 1`;
   - else if `maxWall == lastWall`: `counter = counter + 1`;
   - else if `maxWall == remoteWall`: `counter = remoteCounter + 1`;
   - else: `counter = 0`.
5. `lastWall = maxWall`.

### 3.5 When to call `receive`

The clock state is not stored. A client must call `receive`:

- at start-up, for every value in `fieldTs` of every record in the local
  replica;
- for the `ts` of every change in a pull answer;
- for every value in `fieldTs` of every record that arrives as a whole:
  `entities` of a pull or snapshot, and `arrived` of a pull.

A client does not need to call it for its own changes.

---

## 4. Changes

### 4.1 Shape

```json
{
  "id": "01M83XJB5RA3VVDZTFTHGWSEBT",
  "entityType": "task",
  "entityId": "01M83XJA6GPT2FAVXC6RP7S4X3",
  "fields": { "title": "Renew passport" },
  "ts": "001795428000000:00000:7K2M9QXA",
  "clientId": "7K2M9QXA"
}
```

| Field        | Type   | Meaning                                                                                           |
| ------------ | ------ | ------------------------------------------------------------------------------------------------- |
| `id`         | ULID   | Id of this change. New for every change. The server uses it to recognise a change it already has. |
| `entityType` | string | One of `area`, `project`, `heading`, `task`, `checklistItem`, `tag`.                              |
| `entityId`   | ULID   | The entity the change applies to.                                                                 |
| `fields`     | object | Field name to new value.                                                                          |
| `ts`         | string | HLC timestamp (section 3), from `now()`.                                                          |
| `clientId`   | string | 1 to 64 characters. For a client's own changes: its client id, the same as in `ts`.               |

Changes the server writes itself (section 9.3) have `clientId` `"server"`;
changes from an import have `"import"`. A client must not assume that
`clientId` matches the id in `ts` for changes it receives.

### 4.2 Rules

- **Create.** The first change for an entity must carry the complete entity:
  every required field of its type (`spec/entities.md`). Fields with a
  default may be left out. `id` may be included and must then equal
  `entityId`.
- **Update.** Later changes carry only the fields that changed.
- **Validation.** The server merges the change with the stored entity and
  checks the result strictly against the schema of the type. An unknown
  field, a missing required field or a wrong value refuses the push
  (400 `invalid_changes`, section 7.3). A client must therefore never send
  a field the server does not know.
- **Delete.** Deleting is `{"deleted": true}`. A client must never remove a
  record physically because the user deleted it. A deleted record stays in
  the replica as a tombstone and is hidden.
- **`spaceId`.** The field `spaceId` in `fields` is not an entity field. It
  names a space: it places a new entity in that space, or moves an existing
  one (section 6.4). It never appears in `data`.

### 4.3 Applying a change

A record in the replica is:

```json
{
  "entityType": "task",
  "id": "01M83XJA6GPT2FAVXC6RP7S4X3",
  "data": { "id": "01M83XJA6GPT2FAVXC6RP7S4X3", "title": "Renew passport" },
  "fieldTs": { "title": "001795428000000:00000:7K2M9QXA" }
}
```

`data` holds the field values, `fieldTs` the timestamp of the change that
last set each field. `id` has no entry in `fieldTs`.

To apply a change to a record (or to nothing, if the entity is new):

1. If there is no record, start with
   `data = { "id": entityId }`, `fieldTs = {}`.
2. For each `(field, value)` in `fields`:
   - skip `id`;
   - skip `spaceId` (it is handled by the space logic, section 8);
   - let `current = fieldTs[field]`;
   - if `current` is absent, or `ts > current` (string comparison):
     set `data[field] = value` and `fieldTs[field] = ts`;
   - otherwise leave the field as it is.

Values are replaced whole. An object or array value (for example `when`,
`tagIds`, `repeat`) is never merged field by field.

### 4.4 Tie rule

If `ts` equals `fieldTs[field]`, the value already there stays. Equal
timestamps only occur for the same change applied twice, so applying a
change is idempotent and the order in which changes arrive does not matter.

---

## 5. Ordering

### 5.1 Order keys

Entities that the user can sort (areas, projects, headings, tasks,
checklist items, tags) have a field `order`: a non-empty string. Tasks also
have `todayOrder` (their place in Today; null means: use `order`). Moving
one item is one change to that item's `order`; its neighbours are not
touched.

Lists are sorted by `order`, then by `id`, both with ordinal string
comparison. Ties on `order` happen (two devices placing an item at the same
spot); the `id` makes the order stable.

### 5.2 Key generation

Keys are made with the algorithm of the npm package
`fractional-indexing`, version **4.0.0**, called with its default alphabets
(`generateKeyBetween(a, b)` and `generateNKeysBetween(a, b, n)` without
the `digits` and `intDigits` arguments). A client must produce exactly
the same keys as that package for the same input: the test set
(`conformance/order.json`, and every order in `conformance/actions.json`)
compares them. The safest route is to port the package (it is short and
public domain, CC0). The algorithm is described below so it can be checked.

**Alphabets.**

- Digits (base 62), ascending by character code:
  `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`.
  The zero digit is `0`.
- Heads (base 52): `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`.

**Key structure.** A key is an _integer part_ followed by an optional
_fraction_.

- The integer part starts with a head character that gives its total
  length (head included). With `i` the index of the head in the head
  alphabet: for `a` to `z` (`i >= 26`) the length is `i - 26 + 2`
  (`a` = 2, `b` = 3, ..., `z` = 27); for `A` to `Z` (`i < 26`) the length is
  `26 - i + 1` (`Z` = 2, `Y` = 3, ..., `A` = 27). The rest of the integer
  part is base-62 digits.
- Lower-case heads are the positive integers, growing in length; upper-case
  heads are the negative integers, growing in length the further they are
  from `Z`.
- The fraction is base-62 digits and must not end in `0`.
- The key `A` followed by 26 zeros is reserved and invalid.

**midpoint(a, b)** of two digit strings with `a < b` (`b` may be absent,
meaning "after everything"; neither ends in `0`):

1. If `b` is present: find the longest common prefix of `a` (padded with
   `0` while comparing) and `b`. If it is not empty, return that prefix plus
   `midpoint` of the remainders.
2. Let `da` = value of the first digit of `a` (0 if `a` is empty) and
   `db` = value of the first digit of `b` (62 if `b` is absent).
3. If `db - da > 1`: return the single digit with value
   `round((da + db) / 2)` (round half up).
4. Else, if `b` is present and longer than one digit: return the first
   digit of `b`.
5. Else: return digit `da` followed by `midpoint(rest of a, absent)`.

**increment(integer part)**: add one to the digits after the head, carrying
from the right (digit `z` wraps to `0`). If the carry runs out of the
digits, move the head one step up in the head alphabet and lengthen or
shorten the digit run to the new head's length (when growing, append a
`0`; when shrinking, drop one digit). `z` followed by all `z` has no
successor. **decrement** is the mirror image (digit `0` wraps to `z`, head
one step down, when growing append a `z`).

**generateKeyBetween(a, b)**, where `a` and `b` are keys or null:

1. Both null: return `a0`.
2. `a` null: let `ib` be the integer part of `b` and `fb` its fraction.
   If `ib` is the smallest integer (`A` + 26 zeros): return
   `ib + midpoint("", fb)`. If `b` has a fraction (`ib < b`): return `ib`.
   Else return `decrement(ib)`.
3. `b` null: let `ia`, `fa` be the parts of `a`. Return `increment(ia)`; if
   there is none, `ia + midpoint(fa, absent)`.
4. Both set (if `a > b` they are swapped first): if `ia == ib` return
   `ia + midpoint(fa, fb)`. Else let `i = increment(ia)`; if `i < b` return
   `i`, else return `ia + midpoint(fa, absent)`.

**generateNKeysBetween(a, b, n)**: `n = 0`: none; `n = 1`: one key between.
With `b` null: repeat `generateKeyBetween(previous, null)` starting from `a`.
With `a` null: repeat `generateKeyBetween(null, previous)` starting from `b`,
then reverse. With both set: take the middle key `c` between `a` and `b`,
then `floor(n/2)` keys between `a` and `c` and the rest between `c` and `b`.

**Test vectors** (from version 4.0.0):

| `a`   | `b`   | result |
| ----- | ----- | ------ |
| null  | null  | `a0`   |
| `a0`  | null  | `a1`   |
| null  | `a0`  | `Zz`   |
| null  | `Zz`  | `Zy`   |
| `a0`  | `a1`  | `a0V`  |
| `a0`  | `a0V` | `a0G`  |
| `a0V` | `a1`  | `a0l`  |
| `a0`  | `a01` | `a00V` |
| `az`  | null  | `b00`  |
| `b00` | null  | `b01`  |
| `a0`  | `b00` | `a1`   |

`generateNKeysBetween(null, null, 5)` gives `a0 a1 a2 a3 a4`;
`generateNKeysBetween("a0", "a1", 3)` gives `a0G a0V a0l`.

The server only checks that `order` is a non-empty string. Keys made by
older data or other clients may not be valid fractional-index keys; a
client must not fail on them (sorting still works on any string).

### 5.3 Placing an item

To put one item (or a block of `count` items) at position `index` in a list
of siblings that is sorted as in 5.1 and does not contain the moved items:

1. `before` = order of the sibling at `index - 1` (none at the start),
   `after` = order of the sibling at `index` (none at the end).
2. If either is missing, or `before < after`: the new keys are
   `generateNKeysBetween(before, after, count)`. Only the moved items
   change.
3. Otherwise (`before >= after`: neighbours share an order, or are out of
   order) no key fits between them. **Renumber the whole row**: make
   `siblings.length + count` fresh keys with
   `generateNKeysBetween(null, null, siblings.length + count)`. Siblings
   before `index` take keys `0 .. index-1`, the moved items take keys
   `index .. index+count-1`, siblings from `index` on take the rest. Send a
   change for every sibling whose order actually changed, and for the moved
   items.

---

## 6. Spaces

### 6.1 What a space is

Every entity and every change lives in exactly one **space**. A user sees
the data of the spaces they are a member of, and nothing else.

- Every user has one **personal** space (`kind: "personal"`), created with
  the account.
- A **shared** space (`kind: "shared"`) can have several members. Today a
  shared space only comes into being through an import of an export file
  that lists one; there is no endpoint to create one or to add members (see
  section 12). Clients must still handle several spaces, because the
  protocol is built for them.

### 6.2 Levels

A member has one level per space:

| Level    | May                               |
| -------- | --------------------------------- |
| `read`   | read the space                    |
| `edit`   | read and write                    |
| `manage` | read, write, and manage the space |

The owner of a space has `manage`. A write into a space where the user has
less than `edit` is refused with 403 `space_access` (section 7.3). A client
should not offer editing in a `read` space.

### 6.3 Where a new entity goes

For a change that creates an entity, the server picks the space:

1. the space named by `fields.spaceId`, if present;
2. else the space of its container: for a task `projectId`, `headingId`,
   `areaId`, `templateId` (first one that is set and known); for a project
   `areaId`; for a heading `projectId`; for a checklist item `taskId`;
3. else the user's personal space.

With an explicit `spaceId`, every container the new entity refers to must
be in that same space, otherwise the push is refused
(`invalid_changes`, issue `"<field>: is in another space"`).

The push answer lists where every new entity landed (`placed`,
section 7.3).

### 6.4 Moving between spaces

A change with `fields.spaceId` on an existing entity whose space differs
moves it. Rules:

- Only `area`, `project` and `task` move on their own. A heading, checklist
  item or tag moves with its container; a change trying to move one is
  refused (`invalid_changes`).
- A deleted entity cannot move (`invalid_changes`).
- The user needs `edit` in both spaces (403 `space_access`).
- An agent needs an `all` grant of at least `edit` (403 `agent_scope`).
- The change may carry other fields too; they are applied as usual.

The entity takes its children along: an area its projects and loose tasks,
a project its headings and tasks, a heading its tasks, a task its checklist
items and the instances of its repeat rule (tasks whose `templateId` points
at it). See section 9.3 for what the server writes.

A `spaceId` equal to the entity's current space is not a move; the field is
dropped and the rest of the change is applied.

### 6.5 Cursor per space

A client keeps a **cursor**: a JSON object mapping each space id to the
highest `seq` of that space it has applied.

```json
{ "01M83XJ8801W82E44THBXM8WSS": 1042, "01M83XJ978MX1TK4GVFPBPQJGQ": 977 }
```

`seq` is one counter for the whole server, so values per space have gaps.
A client must only compare and store them; it must not do arithmetic on
them. Values are integers `>= 0`.

- A space missing from the cursor is new to the client; a pull returns it
  as a snapshot.
- A space in the cursor that the user is no longer a member of comes back
  in `removed`.
- The empty cursor `{}` means: nothing seen yet.

---

## 7. Sync endpoints

All three endpoints live under `/api/sync`, answer JSON, and need:

- a signed-in user (session cookie) or a Bearer token of an agent with an
  `all` grant (section 10);
- the header `x-dingen-protocol: 4`.

Checks happen in this order: authentication (401), agent scope (403
`agent_scope`), protocol (426), then the endpoint itself.

### 7.1 Errors common to all sync endpoints

| Status | Body                       | When                                        |
| ------ | -------------------------- | ------------------------------------------- |
| 401    | `{"error":"unauthorized"}` | No valid session or token.                  |
| 403    | `{"error":"agent_scope"}`  | An agent token without an `all` grant.      |
| 426    | `ClientOutdatedBody` (7.5) | Header missing, not an integer, or below 4. |
| 500    | `{"error":"internal"}`     | Server error. Retry later.                  |

### 7.2 `GET /api/sync/pull`

Fetches what changed after the client's cursor, per space.

**Request**

```
GET /api/sync/pull?cursor=%7B%2201M83XJ8801W82E44THBXM8WSS%22%3A1042%7D
x-dingen-protocol: 4
```

`cursor` is required: the cursor (6.5) as JSON, URL-encoded. Use `{}` for
a first sync.

**Response 200**

| Field      | Type               | Meaning                                                                                             |
| ---------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `protocol` | integer            | The protocol the server speaks.                                                                     |
| `spaces`   | array of PullSpace | One entry for every space the user is a member of: the personal space first, then the others by id. |
| `removed`  | array of string    | Space ids from the request cursor the user is no longer a member of. Drop their data.               |
| `cursor`   | object             | The full new cursor: one entry per member space. Spaces no longer a member are absent.              |
| `hasMore`  | boolean            | Some space has more changes than fitted. Pull again with the new `cursor`.                          |

PullSpace:

| Field      | Type                                  | Meaning                                                                                                                                                          |
| ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | string                                | Space id.                                                                                                                                                        |
| `kind`     | `"personal"` or `"shared"`            |                                                                                                                                                                  |
| `level`    | `"read"`, `"edit"` or `"manage"`      | The user's level.                                                                                                                                                |
| `seq`      | integer                               | The cursor for this space after applying this entry.                                                                                                             |
| `changes`  | array of Change                       | Changes after the cursor, oldest first. Empty when `entities` is present.                                                                                        |
| `entities` | array of EntityRecord, optional       | Only for a space that was absent from the request cursor, or marked `resync`: every live (not deleted) entity of the space. Replace what you had for this space. |
| `arrived`  | array of EntityRecord, optional       | Entities that moved into this space (or into your sight) within this range: the whole current record. Apply after `changes`.                                     |
| `left`     | array of `{entityType, id}`, optional | Entities that moved out of this space to where you cannot see them. Drop them. Apply after `changes`.                                                            |
| `hasMore`  | boolean                               | This space has more changes than fitted in this answer.                                                                                                          |
| `resync`   | `true`, optional                      | The client's cursor for this space no longer fits the server (see below). `entities` then holds the whole space.                                                 |

EntityRecord: `{ entityType, id, data, fieldTs }` as in 4.3.

An answer holds at most **500 changes** over all spaces together.
Snapshots in `entities` do not count against that limit.

A space is marked `resync` when the cursor for it is:

- higher than the highest `seq` the server has for that space;
- inside a range of `seq` lost when the server was restored from a back-up;
- lower than the part of the log that was pruned (changes older than a
  year, section 9.4).

Moves are never delivered as plain changes. The server turns its move rows
into `arrived` and `left` per viewer: an entity that moved to another space
the user is also a member of appears in `arrived` of that space and not in
`left`; `left` only lists entities the user can no longer see at all.
`arrived` holds the record as it is now, which may include changes made
after this answer's range.

**Example response**

```json
{
  "protocol": 4,
  "spaces": [
    {
      "id": "01M83XJ8801W82E44THBXM8WSS",
      "kind": "personal",
      "level": "manage",
      "seq": 1044,
      "changes": [
        {
          "id": "01M83XJJZRXEM76TP6F71MPEFH",
          "entityType": "task",
          "entityId": "01M83XJA6GPT2FAVXC6RP7S4X3",
          "fields": { "status": "completed", "completedAt": "2026-11-23T10:05:00.000Z" },
          "ts": "001795428300000:00000:W3HD0P5R",
          "clientId": "W3HD0P5R"
        }
      ],
      "left": [{ "entityType": "project", "id": "01M83XJMY8E50KP8QB9JCG4FKR" }],
      "hasMore": false
    },
    {
      "id": "01M83XJ978MX1TK4GVFPBPQJGQ",
      "kind": "shared",
      "level": "edit",
      "seq": 977,
      "changes": [],
      "entities": [
        {
          "entityType": "tag",
          "id": "01M83XJF2RS20KNZ9XX11BXSJ0",
          "data": {
            "id": "01M83XJF2RS20KNZ9XX11BXSJ0",
            "title": "errands",
            "parentId": null,
            "order": "a0",
            "createdAt": "2026-11-20T08:00:00.000Z",
            "deleted": false
          },
          "fieldTs": {
            "title": "001795161600000:00000:W3HD0P5R",
            "parentId": "001795161600000:00000:W3HD0P5R",
            "order": "001795161600000:00000:W3HD0P5R",
            "createdAt": "001795161600000:00000:W3HD0P5R",
            "deleted": "001795161600000:00000:W3HD0P5R"
          }
        }
      ],
      "hasMore": false
    }
  ],
  "removed": [],
  "cursor": { "01M83XJ8801W82E44THBXM8WSS": 1044, "01M83XJ978MX1TK4GVFPBPQJGQ": 977 },
  "hasMore": false
}
```

**Errors**: 400 `{"error":"invalid_cursor"}` when `cursor` is missing, is
not JSON, or is not an object of space ids (1 to 64 characters) to integers
`>= 0`. Plus the common errors (7.1).

### 7.3 `POST /api/sync/push`

Sends changes. The batch is applied **atomically**: either every change is
applied, or none.

**Request**

```
POST /api/sync/push
content-type: application/json
x-dingen-protocol: 4
```

| Field     | Type             | Meaning                                                                       |
| --------- | ---------------- | ----------------------------------------------------------------------------- |
| `changes` | array of Change  | At most **1000**. Applied in array order.                                     |
| `cursor`  | object, optional | The client's cursor, so the answer can move it past the client's own changes. |

A client must send changes in the order it made them. A change on an entity
must come after the create of that entity.

**Example request**: create a task, then give it a title change, and move
a project to a shared space.

```json
{
  "changes": [
    {
      "id": "01M83XJB5RA3VVDZTFTHGWSEBT",
      "entityType": "task",
      "entityId": "01M83XJA6GPT2FAVXC6RP7S4X3",
      "fields": {
        "createdAt": "2026-11-23T10:00:00.000Z",
        "deleted": false,
        "title": "Renew passport",
        "notes": "",
        "status": "open",
        "projectId": null,
        "headingId": null,
        "areaId": "01M83XJJ0G4S8TKF60KNS2ZCFX",
        "when": { "kind": "date", "date": "2026-11-24" },
        "daypart": "morning",
        "duration": 30,
        "reminder": null,
        "deadline": null,
        "tagIds": [],
        "repeat": null,
        "templateId": null,
        "order": "a1",
        "todayOrder": null,
        "completedAt": null,
        "assigneeId": null
      },
      "ts": "001795428000000:00000:7K2M9QXA",
      "clientId": "7K2M9QXA"
    },
    {
      "id": "01M83XJC50D9YKVDF8Z7QH9FTG",
      "entityType": "task",
      "entityId": "01M83XJA6GPT2FAVXC6RP7S4X3",
      "fields": { "title": "Renew passport and ID card" },
      "ts": "001795428000000:00001:7K2M9QXA",
      "clientId": "7K2M9QXA"
    },
    {
      "id": "01M83XJE3G8JJR40C38H533SKB",
      "entityType": "project",
      "entityId": "01M83XJD4889FYE4A038EVRNFM",
      "fields": { "spaceId": "01M83XJ978MX1TK4GVFPBPQJGQ" },
      "ts": "001795428001000:00000:7K2M9QXA",
      "clientId": "7K2M9QXA"
    }
  ],
  "cursor": { "01M83XJ8801W82E44THBXM8WSS": 1042, "01M83XJ978MX1TK4GVFPBPQJGQ": 977 }
}
```

**Response 200**

| Field        | Type                                           | Meaning                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applied`    | integer                                        | Changes applied (a move counts as one).                                                                                                                                                                                            |
| `duplicates` | integer                                        | Changes skipped because the server already has a change with that `id` from this user.                                                                                                                                             |
| `cursor`     | object, optional                               | Only when the request had a `cursor`. The spaces where nothing but this push happened since the request cursor, with the value moved past the pushed changes. Merge into the local cursor with the maximum per space. May be `{}`. |
| `placed`     | array of `{entityType, id, spaceId}`, optional | Where every entity this push created or moved now lives, including children that moved along and tags the server made in the target space. Absent when there are none.                                                             |

A space where a move happened is never in `cursor`: the server wrote rows
there that the client has not seen, and the client must pull that space.
A space is also left out when its request cursor would need a `resync`.

**Example response** (for the request above; the project moved, so neither
space is moved forward in `cursor`):

```json
{
  "applied": 3,
  "duplicates": 0,
  "cursor": {},
  "placed": [
    {
      "entityType": "task",
      "id": "01M83XJA6GPT2FAVXC6RP7S4X3",
      "spaceId": "01M83XJ8801W82E44THBXM8WSS"
    },
    {
      "entityType": "project",
      "id": "01M83XJD4889FYE4A038EVRNFM",
      "spaceId": "01M83XJ978MX1TK4GVFPBPQJGQ"
    },
    {
      "entityType": "heading",
      "id": "01M83XJKZ086P46SKAE9NS1ECM",
      "spaceId": "01M83XJ978MX1TK4GVFPBPQJGQ"
    }
  ]
}
```

Without the move, and if nobody else wrote in the personal space after
`seq` 1042, the answer's `cursor` would give the personal space the `seq` of
the last pushed change, for example
`"cursor": { "01M83XJ8801W82E44THBXM8WSS": 1044 }`.

**Errors**

| Status | Body                                                                           | When                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}`                                      | Body is not JSON, or does not match the request shape: more than 1000 changes, an id that is not a ULID, an unknown `entityType`, a `ts` that does not match the HLC pattern, a `clientId` outside 1 to 64 characters, a bad cursor. `issues` is a list of schema issues (objects with at least `path` and `message`). |
| 400    | `{"error":"invalid_changes","problems":[{"changeId":"...","issues":["..."]}]}` | One or more changes fail validation (4.2, 6.3, 6.4), or `fields.spaceId` is not a non-empty string. `problems` lists every failing change by its `id`, with readable issues of the form `"<path>: <message>"`. Nothing was applied.                                                                                    |
| 403    | `{"error":"space_access","message":"..."}`                                     | A change writes into a space where the user has less than `edit`, or a move lacks `edit` in both spaces. Nothing was applied.                                                                                                                                                                                          |
| 403    | `{"error":"agent_scope","message":"..."}`                                      | An agent token whose grants do not allow one of the changes. Nothing was applied.                                                                                                                                                                                                                                      |

Plus the common errors (7.1). If a batch has both invalid changes and
changes outside an agent's scope, the answer is `invalid_changes`.

### 7.4 `GET /api/sync/snapshot`

Returns every live entity of the user's spaces, with the cursor to continue
from. A client may use it for the first sync instead of a pull with `{}`;
the reference client uses the pull.

**Request**

```
GET /api/sync/snapshot
GET /api/sync/snapshot?space=01M83XJ978MX1TK4GVFPBPQJGQ
x-dingen-protocol: 4
```

`space` is optional: only that space.

**Response 200**

| Field      | Type                         | Meaning                                                                                                          |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `protocol` | integer                      | The protocol the server speaks.                                                                                  |
| `entities` | array of SpacedRecord        | Every entity with `deleted` not true, in the requested spaces. A SpacedRecord is an EntityRecord plus `spaceId`. |
| `spaces`   | array of `{id, kind, level}` | The spaces in this snapshot, personal first.                                                                     |
| `cursor`   | object                       | Per space the highest `seq` (0 for a space without changes). Continue with a pull from here.                     |

**Example response**

```json
{
  "protocol": 4,
  "entities": [
    {
      "entityType": "area",
      "id": "01M83XJJ0G4S8TKF60KNS2ZCFX",
      "spaceId": "01M83XJ8801W82E44THBXM8WSS",
      "data": {
        "id": "01M83XJJ0G4S8TKF60KNS2ZCFX",
        "createdAt": "2026-11-01T09:00:00.000Z",
        "deleted": false,
        "title": "Home",
        "order": "a0",
        "icon": "home",
        "color": "green"
      },
      "fieldTs": {
        "createdAt": "001793523600000:00000:7K2M9QXA",
        "deleted": "001793523600000:00000:7K2M9QXA",
        "title": "001793523600000:00000:7K2M9QXA",
        "order": "001793523600000:00000:7K2M9QXA",
        "icon": "001793523600000:00000:7K2M9QXA",
        "color": "001793523600000:00000:7K2M9QXA"
      }
    }
  ],
  "spaces": [{ "id": "01M83XJ8801W82E44THBXM8WSS", "kind": "personal", "level": "manage" }],
  "cursor": { "01M83XJ8801W82E44THBXM8WSS": 1042 }
}
```

(The area has no `reviewedAt` and `reviewEvery`; a client reads them as
their default, null.)

**Errors**: 404 `{"error":"not_found"}` when `space` names a space the user
is not a member of. Plus the common errors (7.1).

### 7.5 Client outdated (426)

```json
{
  "error": "client_outdated",
  "protocol": 4,
  "minProtocol": 4,
  "message": "This app is out of date: it speaks an old sync protocol and this Dingen server needs protocol 4 or newer. Reload the web app, or update the Dingen plugin."
}
```

`protocol` is what the server speaks, `minProtocol` the oldest it accepts,
`message` is for people. A client that gets this must stop syncing, keep
its queue, and tell the user to update. It must not retry until it has been
updated.

---

## 8. Client algorithm

This follows the reference client (the web app's sync engine).

### 8.1 Local state

A client stores, durably:

- `clientId` (2.2), made once;
- the **records**: per `(entityType, id)` the `data`, `fieldTs` and the
  `spaceId` the record lives in;
- the **queue**: unsent changes, in the order they were made;
- the **cursor** (6.5).

Records and the queue entry for a local edit must be written in one local
transaction, so a crash never leaves an edit that is visible but not
queued, or the reverse.

### 8.2 Start-up

1. Load or make the client id; create the clock with it.
2. Load the records. Drop records and queued changes of entity types this
   client does not know how to send (a queued change of an unknown type
   would be refused and block the queue).
3. Call `receive` for every `fieldTs` value of every record (3.5).
4. Load the cursor and the queue.
5. Run a sync round (8.4).

### 8.3 A local edit

1. Make a change: new ULID `id`, the fields, `ts = clock.now()`,
   `clientId`.
2. Apply it to the local record (4.3). A new record gets no `spaceId` until
   the server says where it went (`placed`); until then the client may
   assume the space it asked for, or the space of its container, or the
   personal space (6.3).
3. Store the record and append the change to the queue, in one transaction.
4. Schedule a sync round shortly after (the reference client waits 300 ms
   and restarts the timer on each new edit, so a burst of edits goes in one
   push).

A move (6.4) is a change with only `{"spaceId": "<target>"}`. Set the
record's `spaceId` at once; do not put `spaceId` in `data`. Children,
changed containers and tags follow with the next pull.

### 8.4 A sync round

At most one round runs at a time. A request for a round while one runs
schedules exactly one follow-up round.

1. **Push** (8.5), if the queue is not empty.
2. **Pull** (8.6).

### 8.5 Push

1. Take the queued changes in order, at most 1000. If more are queued,
   push in several batches of at most 1000, in order.
2. Send them with the current cursor.
3. On 200:
   - remove exactly the sent changes from the queue;
   - for every entry in `placed`: if the record exists locally, set its
     `spaceId` to the given space (entries for records not yet known locally
     are skipped; they arrive with the pull);
   - if `cursor` is present, merge it into the local cursor: per space, keep
     the maximum of the local and the returned value. Store the cursor.
4. On 400 `invalid_changes`: the listed changes will never be accepted.
   The reference client logs them and removes those changes (by
   `changeId`) from the queue; the rest stays and is pushed in the next
   round. A client must not leave a refused change at the head of the queue,
   or nothing after it is ever sent.
5. On 400 `invalid_body`: the batch as a whole is malformed (a client bug).
   A client must not resend it unchanged in a tight loop.
6. On 403 `space_access` or `agent_scope`: nothing was applied. The
   reference client treats this like a network error and tries again later;
   the queue stays blocked until the user's access changes. A client may
   instead remove the refused changes after telling the user.
7. On a network error or 5xx: keep the queue and stop the round. Try again
   later.

**Lost answers.** If the request reached the server but the answer was lost,
the changes are still in the queue and are pushed again. The server
recognises each change by its `id` and skips it (`duplicates`). Pushing the
same change twice is therefore safe; a client must reuse the same `id` when
it retries and must never make a new change for a retry.

### 8.6 Pull

1. Request `GET /api/sync/pull` with the current cursor.
2. Apply the answer (8.7).
3. Use the returned `cursor` as the cursor for the next request (replace,
   do not merge).
4. While `hasMore` is true, repeat from step 1.
5. Store the cursor.

The reference client stores the cursor once after the last page. A client
may instead store the records and the cursor of each page in one local
transaction. Applying a page twice after a crash is harmless (4.4).

### 8.7 Applying a pull answer

Apply the steps in this order.

1. **Spaces to drop.** Collect `removed` plus the id of every space that has
   `entities` (new to the client, or `resync`).
2. **Keep unsent work.** If any space is dropped, read the queue. For every
   local record whose `spaceId` is a dropped space, remove it, **unless** a
   queued change exists for that record. (A record without a `spaceId`
   counts as living in the personal space.)
3. **Snapshots.** For every space with `entities`: put each record as it
   is, with `spaceId` set to that space, replacing any local record with
   the same type and id. Call `receive` for every `fieldTs` value.
4. **Re-apply unsent changes.** For every queued change whose record was
   just replaced in step 3, apply the change on top of the new record
   (4.3). This keeps local edits visible; they are still in the queue and
   will be pushed.
5. **Changes.** For every space, for every change in `changes`, in order:
   call `receive(ts)`; apply the change (4.3) to the local record. A change
   never moves a record: an existing record keeps its `spaceId`; a record
   that did not exist gets the space of this entry.
6. **Arrivals.** For every space, for every record in `arrived`: put it as
   it is (replacing the local record, wherever it lived) with `spaceId` set
   to this space. Call `receive` for every `fieldTs` value.
7. **Departures.** For every space, for every key in `left`: remove the
   local record.
8. Ignore any change, entity or arrival of an unknown entity type (1.3).

### 8.8 When to sync

The reference client runs a round:

- 300 ms after a local edit (debounced);
- every 15 seconds while the app is visible;
- when the app regains focus, becomes visible, or comes back online;
- at start-up.

There is no exponential back-off in the reference client: a failed round
simply waits for the next trigger. A native client may add back-off for
network errors and 5xx answers. It must keep the queue across restarts.

### 8.9 Status handling

| Answer                | What the client does                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401                   | Stop syncing, keep the queue and the replica, ask the user to sign in again. After signing in, the same replica continues if it is the same user. |
| 426 `client_outdated` | Stop syncing and all timers, keep the queue, tell the user to update.                                                                             |
| network error, 5xx    | Keep everything, try again later.                                                                                                                 |

A replica belongs to one user. A client must keep separate replicas (and
client ids) per user, and must not push one user's queue with another
user's session.

---

## 9. What the server does on its own

A client must expect these, and must not be surprised when the server's
state differs slightly from what it pushed.

### 9.1 Validation

Every pushed change is merged with the stored entity and checked against
the strict schema of its type (4.2). Retired fields in stored data (task
`evening` and `time`) are ignored during this check.

For agent tokens, every change is also checked against the agent's grants
(10.6).

### 9.2 Tag titles

A pushed change to a `tag` with a string `title` is stored with the title
normalized: leading and trailing white space removed, every run of white
space replaced by one space, then lower-cased (the server uses the `nl`
locale, which has no special lower-casing rules, so this equals the Unicode
default lower-case mapping).

The stored change keeps the client's `ts`. Because of the tie rule (4.4)
the client's own un-normalized value would win locally. A client must
therefore normalize tag titles itself, the same way, before it makes the
change.

### 9.3 Moves

For a move of entity E from space A to space B, the server writes, for E
and for every child that moves with it:

- a **leave** row in A: fields `{ "spaceId": "<B>" }`;
- an **arrival** row in B: fields `{ "spaceId": "<B>" }`. For E this row
  has the id, `clientId` and other fields of the pushed change; for a child
  it gets a server-made id and `clientId` `"server"`;
- when needed, a **fix** row in B (`clientId` `"server"`):
  - references to containers that stay behind in A are set to `null`
    (`projectId`, `headingId`, `areaId`, `templateId` of a task; `areaId` of
    a project; and so on);
  - `tagIds` are swapped for tags of B: a tag already in B stays; any other
    tag becomes the live tag of B with the same title (compared trimmed and
    lower-cased), and if B has none, the server **creates** that tag in B;
    unknown and deleted tags are dropped.

  The fix row's `ts` is just after the latest timestamp the entity had:
  the same wall time and client id, counter plus one. It wins over every
  earlier value.
- for every created tag: a create change in B (`clientId` `"server"`) with
  `title`, `parentId: null`, `order` copied from the original tag,
  `createdAt` and `deleted: false`.

Entities keep their ids. Clients do not see the move rows as changes; they
see `arrived` and `left` (7.2). Fix rows and tag creates come as ordinary
changes in B. That is why a push with a move never moves the cursor forward
for A or B (7.3): the client must pull them.

### 9.4 Change log pruning

Changes received more than **one year** ago are deleted from the log. The
newest change of every space is always kept. The current state of every
entity (data, `fieldTs`, tombstones) is kept, so no data is lost. A client
whose cursor for a space is below the pruned part gets that space again as
a snapshot marked `resync`. A client that has been offline for more than a
year therefore resyncs; its queue is still pushed first and survives
(8.7 step 2 and 4).

### 9.5 Restores

After the server is restored from a back-up, cursors that point into the
lost range of `seq`, or beyond the highest `seq`, get a `resync` snapshot.
Changes a client still has in its queue are pushed again in the normal
way. Changes the client had pushed and the server lost are not re-sent by
the protocol; they are gone from the server unless the client still had
them queued.

---

## 10. Signing in

All auth endpoints live under `/api/auth`, take and answer JSON, and need
no protocol header.

### 10.1 How requests are authenticated

On every `/api/*` request the server looks for, in this order:

1. an `Authorization: Bearer <token>` header. If present, only the token is
   used (a cookie is then ignored). A token that does not resolve, or whose
   agent was revoked or whose account is blocked, gives no user: the request
   is anonymous.
2. else the cookie `dingen_session`. A session that does not exist, has
   expired, or whose account is blocked, gives no user.

An endpoint that needs a user answers 401 `{"error":"unauthorized"}` to an
anonymous request.

There is no CORS support and no CSRF token; native clients send plain HTTP
requests.

### 10.2 `POST /api/auth/login`

**Request**

```json
{ "email": "ada@example.com", "password": "correct horse battery" }
```

`email` must be a valid address of at most 254 characters (compared
case-insensitively, trimmed); `password` 8 to 1024 characters.

**Response 200, signed in**: a session is created and set as a cookie
(10.4). Body:

```json
{
  "user": {
    "id": "01M83XJG2035GE7YC9AMPACXG9",
    "email": "ada@example.com",
    "createdAt": "2026-11-01T09:00:00.000Z",
    "isAdmin": true,
    "homeAssistant": false,
    "hasPassword": true,
    "todaySeenOn": null,
    "twoStep": false,
    "blocked": false
  }
}
```

**Response 200, second step needed**: the account has two-step
verification on. No session yet, no cookie. Body:

```json
{ "twoStep": true, "challenge": "Zq0l2y7l5v0T3qkqJm8XoQb0mF2rVwq9hYk1c4d6e8A" }
```

**Errors**

| Status | Body                                      | When                                                                                                                               |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body missing or malformed.                                                                                                         |
| 401    | `{"error":"invalid_credentials"}`         | Unknown address or wrong password.                                                                                                 |
| 403    | `{"error":"account_blocked"}`             | Right password, but an administrator blocked the account.                                                                          |
| 429    | `{"error":"too_many_attempts"}`           | 10 failed attempts for this address from this client address within 15 minutes. The lock lifts 15 minutes after the first failure. |

The client address for the rate limit is the first value of
`X-Forwarded-For`; without that header every client counts as the same
address. The
counters live in memory and reset when the server restarts.

### 10.3 `POST /api/auth/login/two-step`

The second step: a 6-digit code from the authenticator app, or one of the
recovery codes.

**Request**

```json
{ "challenge": "Zq0l2y7l5v0T3qkqJm8XoQb0mF2rVwq9hYk1c4d6e8A", "code": "492817" }
```

`challenge` 1 to 200 characters, `code` 1 to 64.

**Response 200**: a session is created and set as a cookie (10.4). Body:
`{ "user": { ... } }` as in 10.2. When a recovery code was used, the body
also has `"recoveryCodesLeft": <integer>`.

**Errors**

| Status | Body                                      | When                                                                                                         |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 400    | `{"error":"invalid_body","issues":[...]}` | Body malformed.                                                                                              |
| 401    | `{"error":"invalid_code"}`                | Wrong code. The same challenge may be tried again.                                                           |
| 403    | `{"error":"account_blocked"}`             | Account blocked after the password step.                                                                     |
| 410    | `{"error":"challenge_expired"}`           | Unknown or expired challenge. Start again with the password.                                                 |
| 429    | `{"error":"too_many_attempts"}`           | 5 wrong codes on this challenge, or 10 wrong codes for the account within 15 minutes. The challenge is gone. |

A challenge lives **5 minutes**. Challenges are kept in memory; a server
restart ends them (`challenge_expired`).

### 10.4 The session

- The session token is a random 32-byte value, base64url-encoded (43
  characters). The server stores only its SHA-256 hash.
- It is returned **only** as the cookie `dingen_session` in a `Set-Cookie`
  header, with `HttpOnly`, `SameSite=Lax`, `Path=/`, `Expires` set to the
  end of the session, and `Secure` when the request came over HTTPS
  (directly, or with `X-Forwarded-Proto: https`).
- A session lasts **30 days** from sign-in. Using it does not extend it.
  After that the user must sign in again (with the second step, if on).
- A native client must read the cookie value from `Set-Cookie` and send it
  back as `Cookie: dingen_session=<token>` on every request. It must store
  it in the platform's secure storage.
- Resetting the password through the "forgot password" flow signs out every
  session of the account.

### 10.5 Other auth endpoints

**`GET /api/auth/me`** (needs a user). Answers who is signed in:

```json
{
  "user": {
    "id": "01M83XJG2035GE7YC9AMPACXG9",
    "email": "ada@example.com",
    "createdAt": "2026-11-01T09:00:00.000Z",
    "isAdmin": true,
    "homeAssistant": false,
    "hasPassword": true,
    "todaySeenOn": "2026-11-23",
    "twoStep": true,
    "blocked": false
  },
  "source": "session",
  "member": "user:01M83XJG2035GE7YC9AMPACXG9",
  "ingress": false
}
```

`source` is `"session"` or `"token"`; `member` is the member id that will
be recorded as the author of changes (`agent:<id>` for a token); `ingress`
is true only for requests through Home Assistant's ingress port. 401 when
not signed in. A client may use this to check a stored session at start-up.

**`POST /api/auth/logout`** (no body). Deletes the session named by the
cookie, if any, and clears the cookie. Always answers 200
`{"ok": true}`.

**`GET /api/auth/status`** (no user needed). Describes the server:

```json
{ "hasUsers": true, "registrationOpen": false, "registration": "invite", "passwordReset": true }
```

| Field              | Meaning                                                                             |
| ------------------ | ----------------------------------------------------------------------------------- |
| `hasUsers`         | false on a fresh server: the first account is still to be made.                     |
| `registrationOpen` | true when anyone may create an account now (registration `open`, or no users yet).  |
| `registration`     | `"closed"`, `"open"` or `"invite"`.                                                 |
| `passwordReset`    | present and true when "forgot password" works (mail and public address configured). |
| `demo`             | present and true on a demo server.                                                  |

The server also has endpoints for registering, invitations, password reset
and setting up two-step verification (`/register`, `/invite/:token`,
`/forgot`, `/reset`, `/two-step/*`, `/password`, `/today-seen`). They are
outside the scope of this file. Two-step setup and password change accept
only a session, not a token.

### 10.6 Bearer tokens

Tokens have the form `dgn_` followed by 43 base64url characters. They
belong to **agents**, not to people:

- An agent is made by the owner in the web app (`POST /api/agents`, which
  accepts only a session). The token is shown once.
- Requests with a token act as that agent. Changes are recorded with author
  `agent:<agentId>`, not as the user.
- An agent has **grants**: `{scope, level}` with scope `all`, `inbox`,
  `area` (with `id`) or `project` (with `id`), and level `read`, `edit` or
  `manage`.
- The sync endpoints, export and push subscriptions need an `all` grant of
  at least `read`; otherwise 403 `agent_scope`. Within sync, every pushed
  change is still checked: tasks and checklist items need `edit` where they
  are, other types need `manage`; creating a tag needs `edit` somewhere,
  changing a tag needs `manage` on everything; moving between spaces needs
  `edit` on everything.
- Tokens are refused (403 `session_required`) by everything under
  `/api/admin`, by agent management (`/api/agents`) and by two-step and
  password settings.
- A token does not expire. It stops working when the agent is revoked or
  its token is rotated, or when the account is blocked.

A native app used by a person should sign in with a session, not with an
agent token.

---

## 11. Other endpoints

### 11.1 `GET /api/health`

No user needed.

```json
{
  "status": "ok",
  "app": "Dingen",
  "version": "1.0.0-beta.1",
  "build": "9baef93",
  "database": "ok",
  "sqliteVersion": "3.46.1",
  "syncProtocol": 4
}
```

`build` is a short commit hash or null. A client may use `app` to check that
an address really is a Dingen server, and `syncProtocol` to check that it
speaks protocol 4 before signing in.

### 11.2 `GET /api/members`

Needs a user (session or any token). The people and agents that can appear
as author or assignee: the account owner, then its live (not revoked)
agents.

```json
{
  "members": [
    {
      "id": "user:01M83XJG2035GE7YC9AMPACXG9",
      "kind": "user",
      "name": "ada@example.com",
      "icon": null,
      "color": null
    },
    {
      "id": "agent:01M83XJH1853HJTPM0Z0VPMPNG",
      "kind": "agent",
      "name": "Claude Code",
      "icon": "bot",
      "color": "purple"
    }
  ]
}
```

For a user, `name` is the email address and `icon` and `color` are null.
For an agent they are its name and an area icon and colour id.

### 11.3 `GET /api/access`

Needs a user. Who can reach an area or project, and at which level.

```
GET /api/access?type=project&id=01M83XJD4889FYE4A038EVRNFM
```

`type` is `area` or `project`; `id` 1 to 100 characters.

```json
{
  "members": [
    { "member": "user:01M83XJG2035GE7YC9AMPACXG9", "level": "manage" },
    { "member": "agent:01M83XJH1853HJTPM0Z0VPMPNG", "level": "edit" }
  ]
}
```

The owner always has `manage`. An agent is listed with the highest level any
of its grants gives on that place, and left out when it has none.

**Errors**: 400 `{"error":"invalid_query","issues":[...]}`; 404
`{"error":"not_found"}` when the area or project does not exist, is
deleted, or (for a token) is outside what the agent can read; 401.

### 11.4 Unknown paths

Any unknown path under `/api/` answers 404 `{"error":"not_found"}`.

---

## 12. Open points

Things a native client needs that the server does not offer today. Listed
as facts, without a proposed design.

1. **No token in the response body.** The session token is only delivered
   in a `Set-Cookie` header. A native client has to parse that header.
2. **Sessions end after 30 days.** The lifetime is fixed and is not
   extended by use. There is no endpoint to refresh a session; the user must
   sign in again, including the second step.
3. **No device sessions.** A session is not linked to a device or named,
   and there is no endpoint to list or revoke sessions per device.
4. **No way to create or join shared spaces.** Apart from importing an
   export file, there is no endpoint to create a shared space, invite
   members, change levels or leave a space.
5. **Spaces have no name.** A space is only `{id, kind, level}`; a client
   cannot show a name for a shared space.
6. **No change notification.** The server has no endpoint that tells a
   client that new changes exist (no long poll, server-sent events or
   websocket). Clients poll.
7. **No native push notifications.** Reminders and assignment notices are
   sent as Web Push only (`/api/push`). There is no registration for
   platform push services.
8. **Rate limit without a proxy.** When no `X-Forwarded-For` header reaches
   the server, all clients count as one address for the sign-in rate limit.
