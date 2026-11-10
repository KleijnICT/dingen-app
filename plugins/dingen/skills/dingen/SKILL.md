---
name: dingen
description: Manage tasks in Dingen, a self-hosted task manager with the Things workflow, through its MCP tools. Use when the user wants to capture a task, see what is on today, plan or reschedule work, process the inbox, organise areas and projects, or review their lists in Dingen.
---

# Dingen

Dingen follows the Things way of working. The MCP server `dingen` gives you
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
- **Logbook**: completed and canceled tasks.
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

## Tool notes

- `list_tasks` filters combine: a list, a project, an area or a tag.
- `create_task` accepts `when` as `inbox`, `anytime`, `someday`, `today`,
  `tomorrow` or `YYYY-MM-DD`, plus `evening`, `deadline`, `heading`,
  `checklist` and `repeat`.
- `update_task` with `checklist` replaces the whole checklist; pass existing
  item ids to keep them. `repeat: null` stops repeating.
- `complete_project` hides the project's open tasks from the lists; it can be
  reopened.
- Dates are in the user's time zone; "today" follows the server setting.
