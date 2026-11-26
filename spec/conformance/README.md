# Conformance test set

Operations with their input and the output of the reference implementation
(`@dingen/core`). A client in another language runs every case against its
own code and compares the result.

- `manifest.json` lists the suites and the `version` of the set. The version
  goes up with every change to these files.
- Each suite is one file: `{ "suite", "version", "description", "cases" }`.
- A case is `{ "name", "op", "input", "expected" }`. `op` says which
  operation to run; the tables below say what each one means.

Compare results as JSON values: objects without regard to key order, arrays
in order unless stated otherwise. `null` in `expected` also stands for "no
result". Where an input entity has a field your client does not know, keep it.

The files are generated; do not edit them by hand. See
`packages/core/src/conformance.test.ts`.

## Conventions

- **Ids** are ULIDs. The fixtures use readable ones:
  `0000000000000000000000T001` is task 1 (`A` area, `P` project, `H`
  heading, `T` task, `C` checklist item, `G` tag).
- **Dates** are calendar dates `YYYY-MM-DD` without a time zone. **Weekdays**
  are 0 (Sunday) to 6 (Saturday).
- **today** is always given in the input. A client must never read the
  system clock inside these operations.
- **Entities in the input can be deleted** (`deleted: true`). Unless stated
  otherwise an operation ignores deleted entities.
- **A template** is a task with a `repeat` rule. It is hidden: it is in no
  list. Its **instances** are ordinary tasks whose `templateId` points to it.

## hlc

| op        | input                                        | expected                                                                                                                                                                                                                                            |
| --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`  | `wall` (milliseconds), `counter`, `clientId` | The timestamp string.                                                                                                                                                                                                                               |
| `parse`   | `ts`                                         | `{ wall, counter, clientId }`.                                                                                                                                                                                                                      |
| `compare` | `a`, `b`                                     | -1, 0 or 1: plain string comparison by code unit. This is the order "last writer wins" uses.                                                                                                                                                        |
| `clock`   | `clientId`, `steps`                          | Run the steps on one new clock. A step is `{ "do": "now", "wall" }` or `{ "do": "receive", "wall", "remote" }`; `wall` is what the wall clock reads at that step. The result has one entry per step: the timestamp for `now`, `null` for `receive`. |

## apply-change

| op      | input                                      | expected                                                                                                                                                     |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apply` | `existing` (a record or `null`), `changes` | The record after applying the changes in order. A record is `{ entityType, id, data, fieldTs }`; `fieldTs` holds the timestamp of the last change per field. |

## order

| op         | input                                                                           | expected                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `between`  | `before`, `after` (keys or `null`)                                              | A key that sorts between them. The exact key matters: every client must produce the same one.                                                                                                                                                                                                |
| `nBetween` | `before`, `after`, `n`                                                          | `n` keys between them, in order.                                                                                                                                                                                                                                                             |
| `place`    | `siblings` (`{ id, order }`, sorted, without the moved items), `index`, `count` | Where `count` items land at `index`: `orders` for the moved items, and `renumber` (id to new key) for siblings that must change. `renumber` is empty unless the neighbours share a key or are out of order; then the whole row is renumbered and only siblings whose key changes are listed. |
| `sort`     | `items` (`{ id, order }`)                                                       | The ids sorted by `order`, then by `id`, both as plain strings by code unit (uppercase sorts before lowercase).                                                                                                                                                                              |

## dates

| op            | input                                      | expected                                                                                                    |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `addDays`     | `date`, `days`                             | The date.                                                                                                   |
| `addMonths`   | `date`, `months`, `dayOfMonth` (or `null`) | The same day of the month, or `dayOfMonth` when given; shortened to the last day when the month is shorter. |
| `addYears`    | `date`, `years`, `dayOfMonth` (or `null`)  | As `addMonths` with 12 months per year.                                                                     |
| `weekday`     | `date`                                     | 0 (Sunday) to 6 (Saturday).                                                                                 |
| `dayOfMonth`  | `date`                                     | 1 to 31.                                                                                                    |
| `daysBetween` | `from`, `to`                               | Whole days; negative when `to` is earlier.                                                                  |

## repeat

| op                | input                            | expected                                                                                                                                                                                          |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matches`         | `rule`, `dates`                  | The dates from the list that are in the rule's schedule. Only for rules with `basis: "schedule"`.                                                                                                 |
| `next`            | `rule`, `after`, `notBefore`     | The first date in the schedule after `after` that is not before `notBefore`; `null` when the rule has ended. With `basis: "completion"`: one interval after `after`, and `notBefore` is not used. |
| `first`           | `rule`, `today`                  | The date of the first instance of a new rule, or `null`.                                                                                                                                          |
| `addInterval`     | `rule`, `date`                   | The date one interval later. Months and years take the day of the month of `rule.start`.                                                                                                          |
| `checklistMirror` | `templateItems`, `instanceItems` | What to do to the template's checklist so it matches the instance's, matched by position: `{ update: [{ id, fields }], create: [{ title, order }], remove: [id] }`. Ticks are never copied.       |

## views

| op           | input                                                 | expected                                                                                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lists`      | `today`, `tasks`, `projects`, …                       | For tasks and for projects, the ids in each list, in display order. Upcoming entries carry the date they are shown on.                                                                                                                                                                                                            |
| `containers` | `areas`, `projects`, `headings`, `tasks`, `checklist` | The sidebar and the content of each container: areas in order, projects without an area, projects per area, tasks per area and per project (completed ones too, templates not), headings per project, progress per project (completed / (open + completed), 0 without tasks), and per task its checklist with `done` and `total`. |

Rules the `lists` cases pin down:

- A task whose project is completed, canceled or deleted is in no list except
  the Logbook.
- The Inbox is every open task without a project and without an area,
  whatever its `when`. Such a task with a date is also in Today or Upcoming.
- Today: a date today or earlier, or a deadline today or earlier. Sorted by
  `todayOrder`, or by `order` when that is `null`, then by id.
- Upcoming: not in Today, and a date in the future, else a deadline in the
  future. Sorted by that date, then by `order`, then by id.
- Anytime: `when` is anytime, not in Today, and not in a project that is on
  Someday.
- Someday: `when` is someday. A deadline that has come puts such a task in
  Today as well.
- The Logbook: completed and canceled, newest `completedAt` first. The order
  of two items with the same `completedAt` is free.

## dayparts, duration, tags, reminders

| suite     | op          | input                              | expected                                                                                         |
| --------- | ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| dayparts  | `daypartOf` | `time` (`HH:MM`)                   | `morning`, `afternoon` (from 12:00) or `evening` (from 18:00).                                   |
| dayparts  | `startTime` | `daypart` (or `null`)              | The suggested reminder time.                                                                     |
| duration  | `format`    | `minutes`, `hourUnit` (`h` or `u`) | The short form: `15m`, `1h`, `1h30`.                                                             |
| duration  | `total`     | `durations` (minutes or `null`)    | The sum; `null` counts as 0.                                                                     |
| duration  | `fits`      | `duration`, `max`                  | Does a task with this duration pass the filter "at most `max` minutes"?                          |
| duration  | `parse`     | `input` (what the user typed)      | Minutes, or `null` when it is not a duration from 1 to 1440 minutes. See below.                  |
| tags      | `normalize` | `title`                            | Trimmed, inner whitespace collapsed to one space, lowercase.                                     |
| tags      | `same`      | `a`, `b`                           | Do both titles name the same tag?                                                                |
| reminders | `moment`    | `task`                             | `{ date, time }` of the reminder in local clock time, or `null` when there is nothing to remind. |
| reminders | `fields`    | `task`, `reminder`                 | The fields to write to set this reminder; `{}` when nothing changes or the task has no date.     |

Reading a typed duration (`parse`): trim, lowercase, remove all whitespace,
and replace the first `,` with `.`. Then, in this order: digits with an
optional `m` or `min` are minutes; `H:MM` (one or two minute digits) is hours
and minutes; a number (decimals allowed) followed by `u` or `h` and
optionally one or two digits with an optional `m` is hours plus minutes.
Round the result to whole minutes; it must be 1 to 1440.

## protocol

| op                | input                        | expected                                                                                    |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `mergeCursor`     | `base`, `update` (or `null`) | The cursor with the highest `seq` per space.                                                |
| `parseCursor`     | `raw`                        | The cursor, or `null` when it is not valid. For clients this shows what the server accepts. |
| `requestProtocol` | `header`                     | The protocol number the server reads from the header; 0 when it names none.                 |

## entities

| op               | input                                        | expected                                                                                                                              |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`          | `entityType`, `data`                         | `{ ok: true, entity }` with the defaults filled in for absent fields, or `{ ok: false }`.                                             |
| `validateChange` | `change`, `existing` (entity data or `null`) | `{ ok }`: would the server accept this change? Without `existing` the change must form a complete entity. Unknown fields are refused. |
| `new`            | `now`, `entityType`, `fields`                | A new entity with the defaults of Dingen. Its id is random: `expected` has `"$1"` there. `createdAt` is `now`.                        |

## actions

What a client writes when the user does something. Every client must write
the same changes, so that a task completed on a phone looks the same as one
completed in the browser.

The input is the whole account (`tasks`, `projects`, `areas`, `headings`,
`tags`, `checklist`), `today`, `now` (the time for `createdAt` and
`completedAt`) and the `action`. `expected` is the list of writes:

- `{ "write": "create", "entityType", "entity" }`: a new entity, complete.
- `{ "write": "change", "entityType", "entityId", "fields" }`: changed fields
  of an existing entity. Each write becomes one change in the sync log.

New ids are random. In `expected` they are named `$1`, `$2`, … in the order
the entities are created; match them by position. The order of the writes is
free, except that an entity is created before anything refers to it.

| `action.kind`          | Other fields       | Meaning                                                                                                                                                                                                                                             |
| ---------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toggleTask`           | `taskId`           | Complete an open task, or reopen a completed or canceled one. Completing an instance creates the next one.                                                                                                                                          |
| `deleteTask`           | `taskId`           | Delete a task. Deleting an open instance skips that occurrence.                                                                                                                                                                                     |
| `changeTask`           | `taskId`, `fields` | Any edit of task fields. Some fields of an open instance are mirrored to its template.                                                                                                                                                              |
| `moveTask`             | `taskId`, `target` | Move to a list (`{ kind: "when", when, daypart? }`), a project (`{ kind: "project", projectId, headingId? }`), an area (`{ kind: "area", areaId }`) or out of every container (`{ kind: "none" }`). An absent `daypart` means: keep the task's own. |
| `setRepeat`            | `taskId`, `rule`   | Give a task a repeat rule, or change the rule of an instance.                                                                                                                                                                                       |
| `stopRepeat`           | `taskId`           | End the repetition; the instance stays as a plain task.                                                                                                                                                                                             |
| `duplicateTask`        | `taskId`           | A copy right below the task.                                                                                                                                                                                                                        |
| `convertTaskToProject` | `taskId`           | The task becomes a project; its checklist items become tasks.                                                                                                                                                                                       |
| `changeChecklist`      | `taskId`, `items`  | The checklist of the task is now `items`: what to write to its template's checklist. (The writes to the instance's own items are not part of this case.)                                                                                            |
| `toggleProject`        | `projectId`        | Complete or reopen a project.                                                                                                                                                                                                                       |
| `deleteProject`        | `projectId`        | Delete a project with its headings and tasks.                                                                                                                                                                                                       |
| `deleteArea`           | `areaId`           | Delete an area with its projects and tasks.                                                                                                                                                                                                         |

## review

| op             | input                                  | expected                                                                                                                                                                                                                  |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextReviewOn` | `item` (an area or a project), `today` | The date from which it is due: the date of `reviewedAt` plus `reviewEvery` (default every week; months as `addMonths`), or `today` when never reviewed.                                                                   |
| `isDue`        | `item`, `today`                        | Reviewable and `nextReviewOn` ≤ `today`. Reviewable: an area that is not deleted, or a project that is open (Someday included) and not deleted.                                                                           |
| `queue`        | `today`, `areas`, `projects`           | The due items `{ kind, id, nextReviewOn }` in sidebar order: projects without an area, then each area followed by its projects, each by `order` then id. An item due on an earlier day is due all the same.               |
| `selectAfter`  | `queue` (ids), `id`                    | The id to select after `id` is marked reviewed: the next one, else the one before, else `null`. When `id` is not in the queue: the first, or `null`.                                                                      |
| `age`          | `reviewedAt` (or `null`), `today`      | How long ago, in the largest whole unit: under 7 days `day`, under 30 `week` (days / 7), under 365 `month` (days / 30), else `year` (days / 365), rounded down; `null` when never. A date after `today` counts as 0 days. |
| `openCount`    | `entry` (`{ kind, id }`), `tasks`      | Open tasks that are not deleted and not templates: of a project, those with that `projectId`; of an area, those with that `areaId` and no project.                                                                        |

The date of `reviewedAt` is its calendar date on the device's clock. The
cases use instants at 12:00 UTC, which fall on the same date in every
time zone from UTC−11 to UTC+11.

## today

| op                | input                             | expected                                                                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextWeek`        | `today`                           | "Next week" in the When picker: the next Monday; on a Monday the Monday a week later.                                                                                                                                                                                                                             |
| `tasksByDaypart`  | `tasks` (`{ id, daypart }`)       | `{ none, morning, afternoon, evening }` with the ids, in the order given. Today shows `none` first.                                                                                                                                                                                                               |
| `eventSpan`       | `event`, `date`                   | `allDay`, `single` (starts and ends that day), or for a timed event over several days `first`, `middle` or `last`.                                                                                                                                                                                                |
| `eventsOnDay`     | `events`, `date`                  | The ids of the events on that day: all-day events and middle days first, then by time (the start time; `00:00` on the last day), then by title, then by id. These compare with JavaScript's `localeCompare` (the platform's default collation); the cases only use titles where that agrees with code-unit order. |
| `eventsByDaypart` | `events`, `date`                  | The events of `eventsOnDay` per group: under the daypart of their start time when they start that day (`single`, `first`), else in `none`.                                                                                                                                                                        |
| `newInToday`      | `tasks`, `setOn`, `today`, `seen` | The ids of the tasks that are new in Today (below).                                                                                                                                                                                                                                                               |

"New in Today" (the banner with a dot per task): an open task with a date
`d` where `seen` < `d` ≤ `today` (`seen` is `todaySeenOn`, api.md §3.4; when
it is `null`, `d` must be `today`), and whose `when` was set on a day before
`d`. `setOn` gives that day per task id: the calendar date, on the device's
clock, of the wall time of the task's `fieldTs.when` (protocol.md §3);
`null` when unknown, and then the task is not new.

## tag-tree

Tags are in spaces; `spaces` maps a tag id to its space id, or `null` when
it is not known yet (a tag that has not synced). A tag with an unknown
space counts as being in every space.

| op               | input                                                        | expected                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tree`           | `tags`                                                       | `{ id, depth }` of the live tags in tree order: each tag followed by its children, siblings by `order` then id. A tag whose parent is deleted or missing is at the top. Tags in a loop of parents come after the rest, each at the top with its children below it. |
| `validParents`   | `tags`, `tagId`, `spaces`                                    | The tree (as `tree`) without the tag itself, its descendants and tags in another space.                                                                                                                                                                            |
| `nameIssue`      | `tags`, `tagId` (or `null` for a new tag), `typed`, `spaces` | `"empty"` when the normalized name is empty; `"taken"` when another live tag has the same name (for a renamed tag: in the same space; for a new tag: anywhere); else `null`.                                                                                       |
| `openTaskCounts` | `tasks`                                                      | Per tag id, the number of open tasks (not deleted, not templates) that have it; a tag listed twice on a task counts once. Tags without any are left out.                                                                                                           |
| `deleteTag`      | `tasks`, `projects`, `tags`, `tagId`                         | The writes (as in `actions`): the tag comes off every task and project that has it, its live children get `parentId: null`, then the tag gets `deleted: true`.                                                                                                     |

## search

| op       | input                                          | expected                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search` | `query`, `areas`, `projects`, `tasks`, `limit` | `{ kind, id }` of the hits, at most `limit`. Words are split on whitespace; text and words are compared after Unicode NFD, removing diacritics, and lowercasing. A hit holds every word. Areas and open projects match on the title; open tasks on the title, else on title and notes together. Order: areas, then projects, then tasks matching on the title, then tasks matching on the notes; within each in the input order. A query without words gives nothing. |
