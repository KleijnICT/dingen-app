---
name: dingen
description: Manage tasks in Dingen, a self-hosted GTD task manager, through its MCP tools. Use when the user wants to capture a task, see what is on today, plan or reschedule work, process the inbox, organise areas and projects, or review their projects and areas in Dingen.
---

# Dingen

Dingen has one fixed way of working. The MCP server `dingen` gives you
tools for it. Work with the model below instead of inventing your own
structure: the user trusts the app because every task is filed the same way.

## The model

- **Inbox**: everything not yet processed: every open task without a project
  or area, whatever its `when`. Capture goes here. A task leaves the Inbox
  once it has a project or area (which makes an Inbox task Anytime); one with
  a date but no list also shows on that date in Today and Upcoming.
- **Today**: tasks with a when-date of today or earlier, or a deadline of
  today or earlier, grouped by daypart: first the tasks without one, then
  Morning, Afternoon and Evening.
- **Upcoming**: tasks with a when-date or deadline in the future.
- **Anytime**: tasks without a date that can be done now.
- **Someday**: ideas without commitment. No dates.
- **Logbook**: what happened, by the user and by agents; `get_activity`
  reads it ("what did the research agent do yesterday?").
- **Areas**: ongoing responsibilities without an end (Work, Home, Health).
- **Projects**: an outcome with an end, made of several tasks, optionally
  grouped under **headings**. A project lives in an area or on its own.
  Phrase a project title as the desired outcome ("Bathroom is tiled",
  "Quote sent to X"), not as a subject ("Bathroom"); suggest that when the
  user creates or renames a project.
- **Tags**: context, such as a place, a person or a tool. Never the subject;
  the area or project already says that. Tags can be nested.

### Dates: when is not a deadline

- **when** is the day the user plans to do it. It decides where a task shows
  up (Today, Upcoming).
- **deadline** is a hard date with consequences. Set it only when there is one.
- No date is the default. A wished-for date clutters Today; only set one when
  the user names it or there is a real deadline.
- **daypart** plans a task with a date for the `morning`, `afternoon` (from
  12:00) or `evening` (from 18:00) of that day; `null` for none. A task has
  no exact time of day. Set a daypart only when the user names a part of the
  day ("tonight", "Friday afternoon").
- **reminder** is the one exact time: a notification on the when-date or an
  earlier day ("call at 14:30" is a daypart afternoon plus a reminder at
  14:30; "remind me the evening before" is a reminder on the day before). Set
  one only when the user names a time or asks to be reminded.
- **duration** is an optional estimate in whole minutes (5, 15, 30, 60, 120 or
  any other, up to 1440). Set it when the user gives one ("takes ten
  minutes"); do not guess. It helps to pick work that fits: `list_tasks` with
  `max_duration` shows only tasks estimated at most that long.

### Repeating tasks

A repeat rule repeats **on a schedule** (every Monday, the 1st of the month) or
**after completion** (two weeks after it was last done). Completing a
repeating task creates the next occurrence; deleting it skips one. Ask which
of the two the user means when it is not obvious: "water the plants every
week" is usually after completion, "pay rent on the 1st" on a schedule.

## How to work

1. **Start with `overview`** in every session. Use the ids it returns instead
   of guessing titles. Projects, areas, headings and tags can be named by id
   or exact title; tasks only by id (find them with `list_tasks` or
   `search`).
2. **Capture fast.** "Remember to…", "put on my list…": create the task with
   no `when`, project or area so it lands in the Inbox. Write the title as a
   concrete next action starting with a verb ("Call the plumber about the
   leak", not "Plumber"). Longer context goes in `notes`. Do not ask follow-up
   questions; processing comes later. If the user names a project, area, date
   or tag, use it.
3. **Use only existing tags.** Create a tag (`create_tag`) only when the user
   asks for it. `tags` on `update_task` replaces the whole set, so include the
   tags that should stay.
4. **Processing the inbox is the user's decision.** Propose, per item, a title,
   project or area, when (date, Anytime or Someday), tags and deadline, in one
   compact list. A task is processed only with both a project or area and a
   when.
   Apply only what the user approves.
5. **"What's on today?"**: `list_tasks` with `list: "today"`. Mention overdue
   deadlines explicitly. Do not move dates without asking.
6. **Structure belongs to the user.** Create an area or project only when the
   user asks or agrees. Renaming tags is done in the app. Deleting a
   project or area (`delete_project`, `delete_area`) takes everything inside it
   along and needs Manage on it: only when the user explicitly asks, and
   prefer `complete_project`.
7. **Prefer reversible actions.** Complete, cancel or move to Someday rather
   than delete. Use `delete_task` only when the user asks to delete.
8. **Report back briefly** after changes: what was created or changed, where,
   and with which date, so the user does not need to open the app to check.

## You are an agent with a scope

The token you connect with belongs to an **agent**: a member of the user's
Dingen with its own name and access. `overview` says who you are (`me`) and
lists the `members` (the user and their agents). Your access is a set of
scopes, each with a level:

- **Scopes**: everything, the Inbox (tasks without project or area), an area
  (with its projects) or a project.
- **Levels**: read; edit (create, change, complete and move tasks and
  checklist items); manage (also projects, headings and areas).

You only see what is in your scope, so an empty list does not mean the user
has nothing there. When a tool says something is outside this agent's scope,
tell the user plainly and suggest they widen the agent's access in Settings →
Agents; do not look for a way around it. Never move something to a place you
cannot reach.

## Assigning

Tasks can be assigned to a member: the user or an agent. Use it for handing
work over, not as a label.

- `create_task` and `update_task` take `assignee`: `"me"` (you), a member id
  from `overview`, or `null` to unassign. A member can only be assigned a task
  they can see.
- `list_tasks` with `assigned_to: "me"` (or a member id) shows what is
  assigned; combine it with `list: "today"` for "what's on my plate today".
- Task output carries `assigneeId`. Assign tasks to the user only when they
  ask or agree, and take a task (`"me"`) when you start working on it.

## Reviews

The review is about projects and areas. Every project and every area has a
review frequency: every N days, weeks, months or years (the default is every
week). Once that time has passed since it was last marked reviewed, it is due.
An area works like a project in the review: it comes up with its loose tasks.
Someday projects come up too; completed and canceled ones do not.

How to guide a review:

1. `review_queue` lists what is due, earliest first: kind (`project` or
   `area`), id, title, the area of a project, `nextReviewOn`, `reviewEvery`
   and its open tasks. An empty list means nothing is due; say so and stop.
2. Walk through the items one by one, conversationally. Show the item and its
   open tasks briefly, ask what the user wants changed, apply it with the
   normal tools, then call `mark_reviewed` (with `project` or `area`). Never
   mark an item reviewed that you did not look at together with the user.
3. Keep project titles as the desired outcome ("Bathroom is tiled"). When a
   title reads like a subject ("Bathroom"), suggest an outcome; the user
   decides.
4. Propose, do not decide. Completing a project, moving it to Someday,
   canceling or deleting happen only after the user agrees. Prefer the
   reversible option (Someday over delete).
5. The user can change how often something comes up: `update_project` and
   `update_area` take `reviewEvery`, for example `{ "n": 2, "unit": "week" }`
   (unit `day`, `week`, `month` or `year`), or `null` for the default of every
   week. `create_area` takes it too. Suggest a longer frequency for things
   that rarely change (a Someday project every few months), but only change it
   when the user asks or agrees.

## Tool notes

- `list_tasks` filters combine: a list, a project, an area, a tag,
  `assigned_to` or `max_duration` (minutes; tasks without a duration drop
  out). Task output carries `daypart` and `duration` when set.
- `create_task` accepts `when` as `inbox`, `anytime`, `someday`, `today`,
  `tomorrow` or `YYYY-MM-DD`, plus `daypart`, `duration`, `deadline`,
  `heading`, `checklist`, `repeat` and `reminder` (`HH:MM`, or
  `YYYY-MM-DD HH:MM` on or before the date; `null` for none). Daypart and
  reminder need a date and go along with a repeating task, like the duration.
  `update_task` takes the same fields; `null` clears them. Moving a task to a
  list without a date clears its daypart and reminder.
- `evening` and `time` are deprecated and will go: they still work for now
  (`evening: true` is the evening daypart, a `time` becomes its daypart plus a
  reminder at that time), but use `daypart` and `reminder` instead.
- `update_task` with `checklist` replaces the whole checklist; pass existing
  item ids to keep them. `repeat: null` stops repeating.
- `complete_project` hides the project's open tasks from the lists; it can be
  reopened.
- `delete_project` and `delete_area` delete with all headings and tasks inside
  (like in the app) and refuse without Manage on that project or area, or on
  Everything.
- `convert_task_to_project` turns a task that turned out to be bigger into a
  project: title, notes, area, tags, plan date and deadline carry over, each
  checklist item becomes a task, and the task itself is deleted. Propose it,
  do not just do it (structure belongs to the user), and suggest phrasing the
  project title as the desired outcome ("Kitchen renovated", not "Kitchen").
  It needs edit where the task is and manage in the target area.
- Project and area output carries `reviewEvery` (the default, every week,
  when none was set) and `reviewedAt`; `overview` shows them for every open
  project and area.
- Dates are in the user's time zone; "today" follows the server setting.
- When a tool answers that the plugin is too old for the Dingen server, tell
  the user to update the Dingen plugin (or the `dingen-mcp` image) and
  restart; do not retry or work around it.
