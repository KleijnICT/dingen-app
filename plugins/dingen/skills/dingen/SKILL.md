---
name: dingen
description: Manage tasks in Dingen, a self-hosted GTD task manager, through its MCP tools. Use when the user wants to capture a task, see what is on today, plan or reschedule work, process the inbox, organise areas and projects, or review their lists in Dingen.
---

# Dingen

Dingen has one fixed way of working. The MCP server `dingen` gives you
tools for it. Work with the model below instead of inventing your own
structure: the user trusts the app because every task is filed the same way.

## The model

- **Inbox**: everything not yet decided. Capture goes here.
- **Today**: tasks with a when-date of today or earlier, or a deadline of
  today or earlier. **This Evening** is the part of Today for later in the day
  (`evening: true`).
- **Upcoming**: tasks with a when-date or deadline in the future.
- **Anytime**: tasks without a date that can be done now.
- **Someday**: ideas without commitment. No dates.
- **Logbook**: what happened, by the user and by agents; `get_activity`
  reads it ("what did the research agent do yesterday?").
- **Areas**: ongoing responsibilities without an end (Work, Home, Health).
- **Projects**: an outcome with an end, made of several tasks, optionally
  grouped under **headings**. A project lives in an area or on its own.
- **Tags**: context, such as a place, a person or a tool. Never the subject;
  the area or project already says that. Tags can be nested.

### Dates: when is not a deadline

- **when** is the day the user plans to do it. It decides where a task shows
  up (Today, Upcoming).
- **deadline** is a hard date with consequences. Set it only when there is one.
- No date is the default. A wished-for date clutters Today; only set one when
  the user names it or there is a real deadline.
- **time** is a time of day on the when-date ("call at 14:30"); setting it
  also sets a **reminder** at that time, which the user gets as a
  notification. Set a time only when the user names one. A reminder can also
  be on its own or on an earlier day ("remind me the evening before").

### Repeating tasks

A repeat rule repeats **on a schedule** (every Monday, the 1st of the month) or
**after completion** (two weeks after it was last done). Completing a
repeating task creates the next occurrence; deleting it skips one. Ask which
of the two the user means when it is not obvious: "water the plants every
week" is usually after completion, "pay rent on the 1st" on a schedule.

## How to work

1. **Start with `overview`** in every session. Use the ids it returns instead
   of guessing titles. Tools accept an id or an exact title.
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
   destination (project, area, Someday), tags and date, in one compact list.
   Apply only what the user approves.
5. **"What's on today?"**: `list_tasks` with `list: "today"`. Mention overdue
   deadlines explicitly. Do not move dates without asking.
6. **Structure belongs to the user.** Create an area or project only when the
   user asks or agrees. Renaming and deleting areas, projects and tags is done
   in the app, not through the tools.
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

Dingen has three built-in reviews; you can guide the user through one. The
progress is the same as in the app (a review started there can be finished
here and the other way round), so always read it with `get_review` instead of
keeping your own list.

- **Daily**: one step, the Inbox empty.
- **Weekly** (due 7 days after the last one): mind sweep, Inbox, look back on
  the last 7 days, overdue and due soon, every active project, every area,
  loose tasks, a Someday scan, and a last "anything forgotten?" sweep.
- **Monthly** (same day next month): look back, every area in depth, Someday
  in depth.

How to guide one:

1. `get_review` shows what is due. `start_review` with the `kind` starts it,
   or resumes the one that is running; it returns the current step and its
   items.
2. Take the steps in order and keep it conversational: show the items of the
   step briefly, ask what the user wants, apply it with the normal tools,
   then tick it off. A project or area is ticked with `mark_reviewed`; other
   steps with `complete_review_step`. The Inbox step is done when the Inbox is
   empty, so process the Inbox (rule 4) rather than ticking it.
3. Use the **signals** on projects and areas to ask the right question:
   `noNextAction` (what is the next step?), `deadlineSoon`, `longQuiet` (still
   alive?), `notReviewedLately`.
4. Propose, do not decide. Completing a project, moving it to Someday,
   canceling or deleting, and ticking a whole step of projects or areas that
   were not each looked at, happen only after the user agrees. Prefer the
   reversible option (Someday over delete).
5. `complete_review` only when the user agrees the review is done. It refuses
   while steps are open; pass `force: true` only when the user wants to stop
   early.

## Tool notes

- `list_tasks` filters combine: a list, a project, an area, a tag or
  `assigned_to`.
- `create_task` accepts `when` as `inbox`, `anytime`, `someday`, `today`,
  `tomorrow` or `YYYY-MM-DD`, plus `evening`, `deadline`, `heading`,
  `checklist`, `repeat`, `time` (`HH:MM`) and `reminder` (`HH:MM`, or
  `YYYY-MM-DD HH:MM` on or before the date; `null` for none). Time and
  reminder need a date and go along with a repeating task.
- `update_task` with `checklist` replaces the whole checklist; pass existing
  item ids to keep them. `repeat: null` stops repeating.
- `complete_project` hides the project's open tasks from the lists; it can be
  reopened.
- Project and area output carries `reviewedAt` and `signals`; `overview`
  shows them for every open project and area.
- Dates are in the user's time zone; "today" follows the server setting.
