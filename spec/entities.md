# Entities

Every entity type of Dingen and its fields, as they travel in the sync
protocol (version 4). The machine-readable form is
`apps/server/test/contract/sync-protocol.json` (JSON Schema, under
`entities`); the cases in `conformance/entities.json` show what is valid.

How entities are created, changed and synced is in [protocol.md](protocol.md).

## Contents

1. [Rules for every entity](#1-rules-for-every-entity)
2. [Value types](#2-value-types)
3. [area](#3-area)
4. [project](#4-project)
5. [heading](#5-heading)
6. [task](#6-task)
7. [checklistItem](#7-checklistitem)
8. [tag](#8-tag)
9. [Repeating tasks](#9-repeating-tasks)
10. [Which list a task is in](#10-which-list-a-task-is-in)

## 1. Rules for every entity

There are six entity types: `area`, `project`, `heading`, `task`,
`checklistItem`, `tag`. The names are case-sensitive.

- A client must ignore entity types it does not know. New types can appear
  in any 1.x release.
- A client must keep fields it does not know: store the whole `data` object
  as it came, and read the fields it understands from it. New optional fields
  can appear in any 1.x release.
- A field marked **default** may be absent in data from an older client or
  server. A client must read an absent field as its default.
- A field without a default is required: a new entity must carry it.
- The server refuses a change with a field it does not know (see
  `validateChange` in the test set). A client must only write the fields in
  this document.
- An entity is never removed. Deleting sets `deleted` to `true`. A client
  hides deleted entities and keeps them in its replica.
- No field refers to a space. The space of an entity is part of the sync
  layer, not of its data (see protocol.md).

Every entity has these fields:

| Field       | Type    | Meaning                                                    |
| ----------- | ------- | ---------------------------------------------------------- |
| `id`        | Id      | Made by the client that creates the entity. Never changes. |
| `createdAt` | Instant | When it was created.                                       |
| `deleted`   | boolean | `true` when deleted.                                       |

## 2. Value types

| Type         | Form                                                                                                                                          | Example                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Id           | A ULID: 26 characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, uppercase. Pattern `^[0-9A-HJKMNP-TV-Z]{26}$`.                                 | `01JCZ3M8K2Q4T6V8X0Z2B4D6F8`               |
| Instant      | ISO 8601 date and time with `Z` or an offset. Clients write UTC with milliseconds.                                                            | `2026-03-10T09:30:00.000Z`                 |
| CalendarDate | `YYYY-MM-DD`, a day as the user sees it, without a time zone. Compares as a plain string.                                                     | `2026-03-10`                               |
| TimeOfDay    | `HH:MM`, 24 hours, `00:00` to `23:59`. Compares as a plain string.                                                                            | `18:30`                                    |
| Order        | A non-empty order key (fractional indexing, see protocol.md). Sort by `order`, then by `id`, as plain strings.                                | `a0V`                                      |
| Status       | `open`, `completed` or `canceled`.                                                                                                            |                                            |
| When         | An object with `kind`: `{ "kind": "inbox" }`, `{ "kind": "anytime" }`, `{ "kind": "someday" }` or `{ "kind": "date", "date": CalendarDate }`. | `{ "kind": "date", "date": "2026-03-10" }` |
| Daypart      | `morning`, `afternoon` or `evening`. The afternoon starts at 12:00, the evening at 18:00.                                                     |                                            |
| Reminder     | `{ "daysBefore": 0 to 365, "time": TimeOfDay }`: that many days before the task's date, at that time on the device's clock.                   | `{ "daysBefore": 1, "time": "20:00" }`     |
| ReviewEvery  | `{ "n": 1 to 999, "unit": "day" \| "week" \| "month" \| "year" }`.                                                                            | `{ "n": 2, "unit": "week" }`               |
| Repeat       | See [Repeating tasks](#9-repeating-tasks).                                                                                                    |                                            |
| MemberId     | `user:<id>` or `agent:<id>`.                                                                                                                  | `user:01JCZ3M8K2Q4T6V8X0Z2B4D6F8`          |

"T or null" below means the field is always present and can be `null`.

## 3. area

The top level: an area of responsibility that holds projects and tasks.

| Field         | Type                | Default | Meaning                                                                                                                |
| ------------- | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `title`       | string              |         |                                                                                                                        |
| `order`       | Order               |         | Place among the areas.                                                                                                 |
| `icon`        | string or null      | `null`  | An icon id, or `null` for the default look. A client shows the default for an id it does not know and keeps the value. |
| `color`       | string or null      | `null`  | A colour id, or `null` for the neutral colour. The same rule for unknown ids.                                          |
| `reviewedAt`  | Instant or null     | `null`  | Last time the area was marked reviewed.                                                                                |
| `reviewEvery` | ReviewEvery or null | `null`  | Review frequency; `null` means every week.                                                                             |

Icon ids: `home`, `briefcase`, `building`, `heart`, `heart-pulse`,
`dumbbell`, `wrench`, `hammer`, `server`, `cpu`, `bot`, `code`, `laptop`,
`wallet`, `piggy-bank`, `bitcoin`, `landmark`, `receipt`, `book-open`,
`graduation-cap`, `pen-line`, `palette`, `camera`, `music`, `gamepad`,
`plane`, `car`, `bike`, `trees`, `sprout`, `sun`, `dog`, `baby`, `users`,
`shopping-cart`, `utensils`, `coffee`, `gift`, `calendar`, `clipboard-list`,
`folder`, `archive`, `globe`, `zap`, `shield`, `lightbulb`, `star`, `flag`.
The names follow the Lucide icon set.

Colour ids: `gray` (neutral), `red`, `orange`, `yellow`, `green`, `mint`,
`blue`, `indigo`, `purple`, `pink`.

## 4. project

A result that takes more than one task. In an area, or loose.

| Field         | Type                 | Default | Meaning                                                                |
| ------------- | -------------------- | ------- | ---------------------------------------------------------------------- |
| `title`       | string               |         |                                                                        |
| `notes`       | string               |         | Plain text; `""` when empty.                                           |
| `areaId`      | Id or null           |         | Its area.                                                              |
| `status`      | Status               |         |                                                                        |
| `when`        | When                 |         | A new project is `anytime`. Clients do not put a project in the Inbox. |
| `deadline`    | CalendarDate or null |         |                                                                        |
| `tagIds`      | Id[]                 |         | Its tags.                                                              |
| `order`       | Order                |         | Place among the projects of its area, or among the loose projects.     |
| `completedAt` | Instant or null      |         | Set when `status` leaves `open`, `null` when it is open.               |
| `reviewedAt`  | Instant or null      | `null`  | As for an area.                                                        |
| `reviewEvery` | ReviewEvery or null  | `null`  | As for an area.                                                        |

## 5. heading

A divider within a project.

| Field       | Type   | Default | Meaning                                  |
| ----------- | ------ | ------- | ---------------------------------------- |
| `projectId` | Id     |         | Its project.                             |
| `title`     | string |         |                                          |
| `order`     | Order  |         | Place among the headings of the project. |

## 6. task

| Field         | Type                       | Default | Meaning                                                                             |
| ------------- | -------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `title`       | string                     |         |                                                                                     |
| `notes`       | string                     |         | Plain text; `""` when empty.                                                        |
| `status`      | Status                     |         |                                                                                     |
| `projectId`   | Id or null                 |         | Its project.                                                                        |
| `headingId`   | Id or null                 |         | Its heading; only with the `projectId` of that heading.                             |
| `areaId`      | Id or null                 |         | Its area, for a task directly in an area.                                           |
| `when`        | When                       |         | A new task is `inbox`.                                                              |
| `daypart`     | Daypart or null            | `null`  | Only with a `when` date.                                                            |
| `duration`    | integer 1 to 1440, or null | `null`  | Estimated minutes.                                                                  |
| `reminder`    | Reminder or null           | `null`  | Only with a `when` date.                                                            |
| `deadline`    | CalendarDate or null       |         |                                                                                     |
| `tagIds`      | Id[]                       |         | Its tags.                                                                           |
| `repeat`      | Repeat or null             |         | Not `null`: this task is a template, see below.                                     |
| `templateId`  | Id or null                 | `null`  | The template this task is an instance of.                                           |
| `order`       | Order                      |         | Place among its siblings: in its project and heading, in its area, or in the Inbox. |
| `todayOrder`  | Order or null              | `null`  | Its own place in Today; `null` means: use `order`.                                  |
| `completedAt` | Instant or null            |         | Set when `status` leaves `open`, `null` when it is open.                            |
| `assigneeId`  | MemberId or null           | `null`  | Who the task is assigned to.                                                        |

Rules a client keeps when it writes:

- A task has a project or an area, never both. A task with a `projectId` has
  `areaId: null`.
- A task without a `when` date has `daypart: null` and `reminder: null`.
- A task in a project or area is not `inbox`: leaving the Inbox for a
  container makes it `anytime`; moving back to the Inbox clears `projectId`,
  `headingId` and `areaId`.

The exact writes for each user action are in `conformance/actions.json`.

Data written before 1.0.0-alpha.6 can still carry the fields `evening` and
`time` on a task. They are retired: a client must ignore them and must not
write them.

## 7. checklistItem

A step within a task.

| Field    | Type    | Default | Meaning                 |
| -------- | ------- | ------- | ----------------------- |
| `taskId` | Id      |         | Its task.               |
| `title`  | string  |         |                         |
| `done`   | boolean |         | Ticked.                 |
| `order`  | Order   |         | Place in the checklist. |

## 8. tag

| Field      | Type       | Default | Meaning                                                                                                     |
| ---------- | ---------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `title`    | string     |         | Lowercase, trimmed, single spaces (see `conformance/tags.json`). The server normalizes a title that is not. |
| `parentId` | Id or null |         | The tag it is nested under.                                                                                 |
| `order`    | Order      |         | Place among the tags.                                                                                       |

Match a typed name against existing tags after normalizing both, so a tag is
never made twice.

## 9. Repeating tasks

A repeating task is two kinds of task entity:

- **The template**: a task with a `repeat` rule. It is hidden: it is in no
  list, gives no reminder, and is never completed. It carries the content that
  every new instance starts with (title, notes, tags, place, daypart,
  duration, reminder) and a checklist of its own.
- **An instance**: a plain task with `repeat: null` and `templateId` set to
  the template. At most one instance of a template is open at a time.

The next instance is not made by the server. The client that completes or
deletes the open instance creates the next one in the same batch of changes.

The rule:

| Field          | Type                             | Meaning                                                                                                                |
| -------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `unit`         | `day`, `week`, `month` or `year` |                                                                                                                        |
| `every`        | integer 1 to 999                 | Every `every` units.                                                                                                   |
| `basis`        | `schedule` or `completion`       | `schedule`: on fixed dates counted from `start`. `completion`: one interval after the day the instance was completed.  |
| `weekdays`     | integers 0 to 6                  | Only for `week` with `schedule`: the weekdays, 0 is Sunday. Empty means the weekday of `start`.                        |
| `start`        | CalendarDate                     | The first date. For months and years its day of the month is the day of every occurrence, shortened in shorter months. |
| `until`        | CalendarDate or null             | No occurrence after this date.                                                                                         |
| `deadlineDays` | integer 0 to 3650, or null       | Each instance gets a deadline this many days after its date; `null` for none.                                          |

Weeks run from Monday: "every 2 weeks" counts weeks from the Monday of the
week of `start`.

The dates are pinned by `conformance/repeat.json`; creating, completing,
skipping, changing and stopping by `conformance/actions.json`.

## 10. Which list a task is in

`when` decides, together with the deadline and the container. The exact
rules and orders are in `conformance/README.md` under "views" and pinned by
`conformance/views.json`.

| List     | Open tasks that                                               |
| -------- | ------------------------------------------------------------- |
| Inbox    | have no project and no area.                                  |
| Today    | have a date today or earlier, or a deadline today or earlier. |
| Upcoming | are not in Today and have a date or a deadline in the future. |
| Anytime  | are `anytime`, not in Today, and not in a project on Someday. |
| Someday  | are `someday`.                                                |
| Logbook  | are completed or canceled (not open).                         |

Templates and deleted tasks are in no list. Tasks of a project that is
completed, canceled or deleted are only in the Logbook.
