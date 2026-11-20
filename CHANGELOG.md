# Changelog

## 1.0.0-beta.1

The first beta: phases 1 and 2 of the roadmap are complete. From this release
on the sync protocol stays compatible until 2.0; the MCP tools may still
change until 1.0. A pre-release; `:latest` points to it. The update runs a
small database migration (with a backup first) and migrates databases from
every earlier release. Reload the web app to get the new version; a tab that
was left open on an older version must be reloaded too. Update the Claude
plugin for its updated skill, and pull the new image for a stdio MCP server
(`dingen-mcp`): web apps and stdio MCP servers from 1.0.0-alpha.9 and earlier
can no longer sync.

- Sync protocol 4. Clients that speak an older protocol (the web app and the
  stdio MCP server from 1.0.0-alpha.9 and earlier) are refused with
  `426 client_outdated` and must update. From now on the web app reloads by
  itself when this happens, and shows "This version of Dingen is out of
  date" if reloading does not help; the stdio MCP server says to update. The
  MCP server over `/mcp` runs in Dingen itself and needs nothing. Gone: pulls
  with `since=` (protocol 1), the conversion of `evening` and `time` for
  protocol 2 clients, and the `seq` over all spaces in snapshot and push
  answers.
- From 1.0.0-beta.1 until 2.0 the sync protocol only grows (new optional
  fields with a default, new entity types); a contract test pins it. The MCP
  server info now reports the Dingen version with the protocol, for example
  `1.0.0-beta.1+protocol.4`; `/api/health` reports `version` and
  `syncProtocol`.
- The step-by-step review of before 1.0.0-alpha.8 is gone as an entity type.
  The database migration `0013_drop_reviews` deletes the stored review runs;
  older export files with reviews still import, without them.
- Every release is now tested to migrate a database of every alpha release
  (1.0.0-alpha.1 to alpha.9) and keep its data.
- The Claude plugin's skill: tasks are named by id (projects, areas, headings
  and tags also by title), and what to do when the plugin is too old.
- Documentation: the README, the roadmap and the contribution notes describe
  the beta.

## 1.0.0-alpha.9

A calmer redesign with one layout for every pane, administration in the app,
password reset and two-step verification. A pre-release; `:latest` points to
it. The update runs two database migrations (with a backup first) and a third
small one for push notifications. Optional: set `SMTP_*` and
`DINGEN_PUBLIC_URL` for mail; Home Assistant users get these as app options.
Registration is now chosen in Settings → Administration; your current
setting carries over. Reload the web app to get the new version.

- Mail: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
  `SMTP_FROM` and `SMTP_SECURE`, and `DINGEN_PUBLIC_URL` (the address people
  open Dingen on, used for links in mail). Settings → Administration shows
  whether mail is set up and sends a test mail.
- Password reset: with mail and `DINGEN_PUBLIC_URL` set up the sign-in
  screen offers "Forgot password?": a link that works once, for an hour, mailed in English or
  Dutch, without telling whether an address has an account. An
  administrator can also make a one-time reset link (24 hours) for a user to
  pass on by hand. A reset signs the account out everywhere; agents' tokens
  keep working.
- Two-step verification with an authenticator app, optional for everyone
  (Settings → Account), with ten recovery codes. Administration shows who
  has it on and can turn it off for someone who lost their phone.
- Administration in Settings, for administrators (replaces the Invitations
  tab): the users with when they joined and were last active; make someone
  an administrator; block an account (signed out everywhere, no sign-in, no
  two-step step or reset link, its API and agent tokens and Home Assistant
  access refused, no notifications) and unblock it; delete a blocked
  account permanently with all its own data, after typing its email address
  and with a backup first. Nobody can block, delete or unadmin themselves or
  the last administrator. Everything under `/api/admin` is for
  administrators in a browser session (or Home Assistant) only; agent and
  API tokens are refused.
- Registration in the app: who may create an account (nobody, with an
  invitation, anyone) is chosen in Administration and stored in the
  database; `DINGEN_REGISTRATION` is only the starting value, and an
  existing server keeps its current setting.
- Backups in the app: the backups are listed with date, kind and size; back
  up now, download one, or restore one after typing "restore". A restore
  makes its own backup first and restarts the server's database in place;
  devices load a fresh copy.
- Two database migrations, with a backup first: `0011_mail_reset_totp`
  (reset links, recovery codes and two-step settings) and
  `0012_blocked_users` (`blocked_at` on `users`).
- A calmer, more consistent look (the first step of a redesign): one set of
  design tokens for space, type, radius, shadow and motion, a finished dark
  theme, quiet buttons with one primary per screen, one icon button, one
  style for the active item, soft menu hovers and section headings without
  capitals. The rules are in `DESIGN.md`.
- One layout for every pane: the sidebar, the review list, the content, the
  task panel, Settings and Search each have the same 48px head with a title
  and icon buttons on the right, so their first lines line up. On a desktop
  the list's actions (new task, When, Move, Tags, …) and the page's own
  (filter, focus, `…`) move from the bottom bar into the content's head; on
  a phone the bottom bar stays. Search sits in the sidebar's head. A project
  in an area shows a quiet "Area ›" path in the head, and the task panel
  shows where its task lives. In the Review the sidebar folds to a rail of
  icons and the review list takes its place; each item says when it was last
  reviewed and how many tasks are open.
- The sidebar folds to a rail of icons with a button in its head, and
  unfolds with the same button on top of the rail (or with `[`). The rail
  shows the lists and the areas; the choice stays on this device, and
  opening a list or area from the rail keeps it folded. In the Review the
  sidebar still folds by itself, but the button unfolds it there too. Search
  in the sidebar's head is a plain magnifying glass. Phones keep the drawer.
- Menus and popovers are one kind of sheet: the same surface everywhere,
  sections with a small heading (Planning, Organisation; When, Daypart),
  icons in front of menu items, the delete action last under a line. On a
  phone they come up from the bottom with a grab handle, and close with a
  tap beside them or a swipe down. Empty lists and pages all show a short
  title with one sentence, and the Logbook no longer shows "Loading…" as if
  it were empty.
- Push notifications arrive in the language of the device: when you turn on
  reminders, the device sends its app language along, and again when you
  change the language. Reminders and "an agent assigned you a task" then come
  in that language (English for devices that did not tell yet; open Settings
  once to update them). The update runs a small database migration (a
  `language` column on `push_subscriptions`), with a backup first.
- The server keeps the change log for a year: older changes are removed
  daily, after the nightly backup (and at startup when overdue), in small
  batches. Your tasks, projects and exports are not affected; the activity
  log (Logbook) no longer goes back more than a year. A device that was
  offline for longer than that loads its data afresh instead of syncing the
  missing changes.

## 1.0.0-alpha.8

A new, simpler review: every project and area has its own review frequency,
and the Review page lists what is due beside the sidebar. Also: Someday items
at the bottom of project and area pages, dragging a whole selection, and
Anytime without what is in Today. A pre-release; `:latest` points to it. The
update runs a small database migration (a column on `users`), with a backup
first. The daily, weekly and monthly reviews are gone; the MCP review tools
changed, so update the MCP plugin. Reload the web app to get the new version.

- A new, simpler review. Every project and area has a review frequency
  (every N days, weeks, months or years; every week unless you change it, in
  the `…` menu of the project or area). Once that time has passed since its
  last review, it shows on the Review page: a list of what is due that slides
  out of the sidebar, in sidebar order, with the selected project or area
  beside it, fully editable. An area shows only its own tasks; its projects
  have their own review. "Mark reviewed" moves on to the next one. Someday
  projects come along too.
  The daily, weekly and monthly reviews with their steps are gone, and so are
  the review signals and the review notice in Today. No database migration.
- MCP: `review_queue` lists what is due for review and `mark_reviewed` marks
  a project or area reviewed; `update_project` and the area tools take a
  review frequency. The step tools (`start_review`, `get_review`,
  `complete_review_step`, `complete_review`) are gone.
- Today shows a banner when tasks came in by themselves, because the date
  they were planned for arrived: "3 new tasks in Today", with a dot on each.
  What you move to Today yourself does not count. OK hides it on every device.
  Database migration: a column on `users`.
- A new project's title asks for the desired outcome.
- Dragging one of several selected tasks moves all of them, wherever you
  drop them (a list, project, area, heading or a place in the list), in
  their order; the drag shows how many. Moving a selection keeps its order.
- Anytime no longer shows what is in Today: a task is in one of the two.
  The project and area pages still show all their tasks.
- On a project's and an area's page, Someday tasks (and an area's Someday
  projects) sit together at the bottom under "Someday", before Completed.
  The circle in front of a Someday task or project is drawn dashed.

## 1.0.0-alpha.7

The Inbox now holds everything that is not processed yet, and the weekly
review walks areas and projects together. A pre-release; `:latest` points to
it. No database migration. After the update, existing tasks without a project
or area show in the Inbox. Reload the web app and update the MCP plugin to
get the new version.

- The Inbox holds every task that is not processed yet: a task leaves it once
  it has a project or area and a When. A task with only a date stays in the
  Inbox and also shows on its date in Today and Upcoming. Existing tasks
  without a project or area now show in the Inbox.
- A new task made on a project's or area's page goes into that project or
  area (Anytime), after its last task; from the other lists it still goes to
  the Inbox.
- Weekly review: Projects and Areas are one step, "Areas and projects": per
  area a card for the area itself, then one for each of its projects. The
  "Loose tasks" step is gone; those tasks are in the Inbox now.
- A project in the weekly review shows its headings and the same order as the
  project's page, and its tasks can be dragged.

## 1.0.0-alpha.6

Dayparts and estimated durations, a calmer task panel and page header, and a
lot of everyday work: selecting several tasks, a drawer on phones, focus mode,
tags in Settings and converting a task into a project. A pre-release;
`:latest` points to it. The update runs a database migration with sync
protocol 3 (with a backup first; if it fails the backup is put back and
Dingen stops). Older apps and the previous MCP plugin keep working; reload
the web app to get the new version.

- A calmer page header on lists, projects and areas: the title with a few quiet icon buttons on its right (Filter, Focus on Today, and the `…` menu, which on Today holds My order / By project) and one muted line under it (on Today the date and the day total). Tag and duration filters live in one Filter popover; a filter that is on shows as a small chip with × under the title.
- Links in notes (http, https and www.) are clickable and open in a new tab; click elsewhere on the text to edit. The notes of a project in a review show links too.
- Drag the edge of the sidebar or the task panel (beside the list) to make it wider or narrower, with mouse, finger or pen; double-click or double-tap puts the default back, and the arrow keys move a focused edge in steps. The widths are kept per device, and the list always keeps room.
- Select several tasks at once (web): Shift-click selects a range, Cmd/Ctrl-click
  adds or removes one, Shift+Arrow extends the selection; on a touch screen a long
  press starts selection mode, where taps add and remove tasks. The toolbar shows
  how many are selected and When, Move and the new Tags button act on all of them;
  Backspace/Delete (or the toolbar's Delete button) deletes them after one
  confirmation. Escape clears the selection.
- Settings → Calendars: removing a calendar now goes through a `…` menu with a confirmation, like deleting a project.
- MCP tools `delete_project` and `delete_area`, only for an agent with Manage
  on that project or area (or on Everything): they delete like the app does,
  including headings, tasks and, for an area, its projects. Without Manage the
  tool refuses with a clear message.
- Focus mode in Today (web): a Focus button in the header, or the F key, shows
  only today's tasks at full width: no calendar events, review banners,
  sidebar or empty groups. Escape leaves it. Remembered per device.
- Push notification when an agent assigns you a task: "Claude assigned you a
  task" with the task title, on the devices where notifications are on.
  Clicking it opens the task. Nothing is sent when you assign a task
  yourself, when an agent sends the same assignee again, or when an agent
  completes a task (that stays in the Logbook).
- On phones the sidebar is a drawer from the left instead of the bottom
  navigation bar: the menu button top left or a swipe from the left screen
  edge opens it, with the same lists, areas, projects, New List and Settings
  as on the desktop. Choosing a list, Escape or tapping beside it closes it.
- Settings → Tags: every tag as a tree with its number of open tasks. Create a
  tag (always lowercase), rename it inline (a name already used in the same
  space is refused), move it under another tag or to the top level, and
  delete it: it comes off its tasks and projects, which stay, and the tags
  directly under it move to the top level. The settings tabs fit on one row
  again.
- Dayparts and estimated duration, groundwork (core and server): a task has a
  daypart (morning, afternoon or evening) instead of This Evening and a time
  of day, and an optional estimated duration. A reminder keeps its own exact
  time and no longer follows the task. The update converts existing tasks
  once, with a backup first: This Evening becomes the evening daypart, a time
  becomes its daypart, and a task with a time but no reminder gets a
  reminder at that time, so no notification is lost. Sync protocol 3 and
  export format 3; older clients and export files keep working and are
  converted.
- Dayparts in the web app: the When picker offers Today, Tomorrow, Next week
  (the Monday of next week), a date and Someday, and under a date a choice of
  no daypart, morning, afternoon or evening; the separate This Evening choice
  is gone. Today shows the tasks without a daypart first, then Morning,
  Afternoon and Evening when they hold something, with calendar events under
  the daypart of their start time; dragging a task into a daypart sets it.
  The estimated time shows per daypart and for the whole day. Upcoming and the
  task panel show the daypart.
- Estimated duration in the web app: add a duration to a task from the Add
  row of the task panel (5m, 15m, 30m, 1h, 2h, or type any value such as 45
  or 1h30); the row shows it small and grey on the right. Today and Anytime
  get a duration filter next to the tags (at most 5m, 15m, 30m or 1h), kept
  per device; tasks without a duration drop out while it is on. The activity
  overview names duration changes.
- MCP tools and plugin: `create_task` and `update_task` take a `daypart`
  (morning, afternoon, evening) and a `duration` in minutes; `list_tasks`
  gets a `max_duration` filter and shows daypart and duration. The old
  `evening` and `time` fields still work for this version and are converted
  (a time becomes its daypart plus a reminder); they are marked deprecated.
  The Dingen skill describes dayparts, reminders as the one exact time, and
  durations.
- The task panel stays open when its task leaves the list, for example after
  choosing Tomorrow in Today, so more fields can be filled in; an OK button
  at the bottom closes it.
- Convert a task to a project, from the task panel's menu or with the MCP
  tool `convert_task_to_project`: the project takes the task's title, notes,
  area, tags, plan date and deadline, each checklist item becomes a task in
  it (ticked items completed), the task is deleted and the project opens.
- A calmer task panel: every field, including notes, checklist, When, list
  and tags, only shows once it has a value; the others are in the Add row,
  and adding one opens it (the When and list choices open right away). A
  section heading only shows with a field in it. A new task now always starts
  in the Inbox, from any list, project or area (the + button is on every list,
  the Logbook too); choosing a When or a list in the panel moves it there.
- Long project and area titles wrap onto more lines instead of being cut off;
  the Logbook's filters (kind, who, period) moved into the filter button,
  with a small chip for each filter that is on.

## 1.0.0-alpha.5

A calmer task panel, spaces as groundwork for sharing, lowercase tags and
backups with a safety net. A pre-release; `:latest` points to it. The update
runs a database migration (with a backup first; if it fails the backup is put
back and Dingen stops).

- Backups: every night from 03:00 (in `DINGEN_TIMEZONE`) Dingen writes a
  consistent backup to `DATA_DIR/backups`, while it runs. Kept: 7 daily, 4
  weekly and 3 monthly, plus the 10 newest from before an update. Backup names
  now hold the kind, the moment and the schema version. `DINGEN_BACKUPS=off`
  turns the nightly ones off.
- A failed update no longer leaves a half-migrated database: if a database
  migration or a one-time data conversion fails at start, Dingen puts back the
  backup it made just before, says so in the log and stops, so the previous
  version can be started. Data conversions get a backup first too.
- The `dingen` command in the Docker image: `dingen backup`, `dingen backups`
  and `dingen restore <file>` (only with the server stopped; saves the current
  state first and refuses files that are not a Dingen database or come from a
  newer version).
- Sync after a restore: devices that are ahead of the server load a fresh
  copy instead of missing changes; unsent changes are kept. Protocol 2 pulls
  mark such a space `resync`; protocol 1 pulls get 409 `cursor_ahead`.
- One server per data directory: the server holds a lock on
  `DATA_DIR/dingen.lock` and does not start when another one (or a restore)
  holds it.
- Task panel: a task opens in a panel that slides in from the right (beside
  the list on wide screens, over it on medium widths, full screen on phones).
  With a mouse a click selects a task and a double click or Enter opens it; on
  touch screens a tap opens. With the panel open, arrow keys and clicks switch
  the task. The address bar holds the open task (`?task=`), so a reload or a
  jump from Search keeps it open.
- The panel is calm: the title with a `…` menu (Duplicate, Delete), notes, the
  checklist with a heading and count, then Planning (When; time and reminder,
  deadline and repeat only when set) and Organisation (List with its heading,
  Tags; Assigned only when set). Empty fields are added from a row at the
  bottom. Everything saves as you type.
- Duplicate a task: the copy lands right below the original, with an
  unchecked checklist, without repeat or assignee.
- Projects and areas show completed tasks in their own folded "Completed"
  section at the bottom, instead of under the last heading.
- Reviews: a weekly or monthly review that was never done counts from the day
  the account was created, so a new account is not asked for a review right
  away. The banners on Today can be closed until tomorrow.
- Tags are always lowercase. Existing tags are converted once at start;
  tags that become equal are merged and tasks point to the one that stays (the
  Logbook shows this as done by Dingen).
- Spaces (groundwork for sharing; nothing changes in use yet): all data
  belongs to a space, every account has a personal space, access goes through
  membership. The sync protocol is version 2 with a cursor per space (`GET
  /api/sync/pull?cursor=`); the old `since=` form keeps working for older
  clients. Entities can move between spaces with their contents. The export
  format is version 2 with the spaces you own; version 1 files still import,
  reviews now included. The update runs a database migration (with a backup
  first).

## 1.0.0-alpha.4

Dingen as a Home Assistant app. A pre-release; `:latest` points to it. The
update runs a database migration (with a backup first).

- Home Assistant: Dingen is a Home Assistant app (add-on), from the repository
  KleijnICT/dingen-app-ha-addon. It opens in the sidebar through ingress and
  signs you in with your Home Assistant user; each Home Assistant user gets an
  own account (the first one is the administrator). Options: registration on
  the direct port and the log level; the time zone comes from Home Assistant.
  Port 8080 is optional, for the installed web app, reminders and MCP. Data
  lives in the app's folder and goes into Home Assistant backups. Every release
  appears as an update in Home Assistant with its changelog.
- Settings → Account: set a password (for an account from Home Assistant) or
  change it. `POST /api/auth/password`; `/api/auth/me` reports
  `homeAssistant` and `hasPassword`.
- The web app works under a path prefix (as Home Assistant ingress serves
  it); there it does not install a service worker or offer web push.
- The Docker image starts as root only to give `/data` to the `node` user,
  then runs as `node`; existing installs are unchanged. The update runs a
  database migration (with a backup first).
- Cache headers for `sw.js`, the manifest and the hashed assets are sent
  again; they were lost.

## 1.0.0-alpha.3

Agents as members, the Logbook as activity and a calendar fix. A
pre-release; `:latest` points to it. The update runs a database migration
(with a backup first): existing API tokens become agents with full access.

- Agents: API tokens became agents, members of your Dingen with a name, icon
  and colour. Each agent has one token (rotate or revoke it) and scopes with a
  level: Everything, the Inbox, an area or a project, each Read, Edit or
  Manage. The MCP and the API only show an agent what is in its scope and
  refuse writes outside it (`403 agent_scope`); moving something out of the
  scope is refused too. The sync API, export and import need the scope
  Everything. Existing tokens became agents with Everything and Manage, so
  connections keep working.
- Every change records who made it (you or which agent).
- Settings → Agents (was Connections): create agents, pick icon and colour,
  give scopes with a level, show the token once, rotate or revoke. A project
  or area has a Members panel in its `…` menu, with avatars next to the title
  when an agent can reach it.
- Assigning: tasks can be assigned to you or an agent that can see them. The
  MCP takes `assignee` (`me`, a member id or null) in `create_task` and
  `update_task`, filters `list_tasks` with `assigned_to`, returns
  `assigneeId` and lists the members in `overview`.
- API: `GET /api/members`, `/api/agents` (create, change, new token, revoke)
  and `GET /api/access`; `/api/auth/me` reports the `member`. The
  `/api/auth/tokens` endpoints are gone.
- Logbook as activity: everything that was added, completed, reopened,
  changed or deleted, by you or by an agent, newest first and per day, with
  the member's avatar and what changed ("changed When from Today to Friday";
  notes only say that they changed). Filters for kind, who and period; more
  loads as you scroll. The list of completed items is the "Completed" filter.
  Changes to the same item by the same member within five minutes are one
  line. API: `GET /api/activity`; MCP: `get_activity`. An agent only sees
  activity on what it can read.
- Area icons: Bitcoin and a gamepad.
- Calendars: a changed or cancelled occurrence of a repeating appointment
  (common in Office 365 / Exchange feeds) no longer shows up under every other
  repeating appointment, so Today no longer lists the same appointment many
  times, and occurrences that clashed with another series' change are back.
  A calendar that failed to load is retried after about a minute instead of
  15, and Settings no longer says there are no calendars while loading.
  Agents need Everything (read) to see calendars and Everything (manage) to
  add, change or remove one.
- Demo: Sam has a Research assistant and a Bookkeeper with a few days of
  work and assigned tasks.
- Roadmap: location reminders in the native apps.

## 1.0.0-alpha.2

Invitation-only registration and safer updates. A pre-release; `:latest`
points to it.

- Invitations: `DINGEN_REGISTRATION=invite` lets people register only with
  an invitation link. The first account is the administrator (on existing
  servers: the oldest account) and creates, copies and withdraws links in
  Settings → Invitations. A link works once and expires after 14 days.
  API: `GET`, `POST /api/invitations`, `DELETE /api/invitations/:id`;
  `/api/auth/me` reports `isAdmin`.
- Backup before migrations: when an update brings database migrations,
  Dingen first copies the database to `DATA_DIR/backups` (ten most recent
  kept). If the copy fails it does not migrate and stops.
- Settings: the seven tabs now fit the window on every width.
- Releases: images built from `main` (pre-releases included) get the
  `latest` tag. Maintainers can let CI roll out every build to a Docker host
  through a stack webhook (`DEPLOY_WEBHOOK_DEV`, `DEPLOY_WEBHOOK_PROD`); the
  run waits until `/api/health` reports the new build. Without the secrets the
  step is skipped.

## 1.0.0-alpha.1

First alpha on the way to 1.0: reviews, calendars, reminders, export and
import, more imports and an installable web app. Not feature complete yet
(see `ROADMAP.md`); expect changes before 1.0.0. This is a
pre-release; `:latest` points to it as well.

- MCP: reviews with Claude. New tools `get_review`, `start_review`,
  `mark_reviewed`, `complete_review_step` and `complete_review`, with the same
  steps, signals and progress as the app; project and area output includes
  `reviewedAt` and signals. The skill explains how Claude guides a review.

- Reviews in the web app: a "Review" item in the sidebar (with a dot when the
  weekly or monthly review is ready), a page with the daily, weekly and
  monthly review, one screen per step with a progress bar, project and area
  cards with signals and "Reviewed" (shortcut R), and a bar on Today when the
  weekly or monthly review is ready.
- Times and reminders: a task with a date can get a time of day and a
  reminder (by default at that time, or on its own, also on an earlier day).
  The time shows in the row, in Today and in Upcoming; both go along to the
  next occurrence of a repeating task. Reminders arrive as notifications via
  web push: turn them on per device in Settings → General (needs HTTPS or
  localhost). The server sends them at the right moment in `DINGEN_TIMEZONE`.
  MCP: `create_task` and `update_task` take `time` and `reminder`.
- Export and import: Settings → Data downloads everything as one JSON file and
  reads such a file back (merging by id, newest change per field wins; importing
  the same file twice changes nothing). Tokens and sessions are never included.
  API: `GET /api/export` and `POST /api/import`.
- Reviews, groundwork (no screens yet): projects and areas get `reviewedAt`,
  a new synced entity `review` (daily, weekly, monthly) keeps progress, and
  `@dingen/core` knows when a review is due, its steps, what each step shows
  and the signals on a project or area (no next action, deadline soon, long
  quiet, not reviewed lately).
- Imports: `dingen-import todoist` (CSV export of a project, or the unzipped
  backup folder) and `dingen-import csv` (generic CSV with columns title, notes,
  project, area, tags, when, deadline, done). Both do a dry run by default,
  write with `--apply` and do not create duplicates when run again.
- Dingen is installable as an app (PWA) with its own icon, and the app itself now
  starts offline; a new version is downloaded in the background and a small bar
  offers "Reload" when it is ready. The API is never cached.
- Better on phones: the bottom bars stay clear of the iPhone home indicator and
  notch, and inputs no longer make iOS zoom in.
- The server serves `sw.js`, the manifest and `index.html` with `no-cache` and
  hashed assets as immutable.
- Calendars (read-only): add ICS feeds (`https://` or `webcal://`) under
  Settings → Calendars, give them a name and colour. Appointments show in a
  compact block at the top of Today and per day in Upcoming (the next 14 days).
  The server fetches the feeds every 15 minutes, handles repeating
  appointments, exceptions and time zones (`DINGEN_TIMEZONE`), and never sends
  a feed URL back to the browser. The web app keeps the last appointments for
  offline use.

- Claude Code plugin: `/plugin install dingen --marketplace KleijnICT/dingen-app`
  connects the MCP server and adds a skill for Dingen's workflow.
- Areas get an outline icon and a colour, chosen on the area page (also right
  after creating one) and shown in the sidebar; `create_area` in the MCP accepts both.
- Dragging areas, projects, tasks and checklist items works again when two of
  them share an order (for example after an import); the row is renumbered.
- Area titles use the full width of the page instead of being cut off.
- Every push to `main` is now a release; the version comes from `package.json`.
- The sidebar shows the version and build (commit) under the sync status;
  `/api/health` reports both.
- Development builds: `ghcr.io/kleijnict/dingen:develop` follows the `develop` branch.
- New bottom bar under every list: new task, new heading (projects) or new
  project (areas), When, Move and Search. New tasks appear as an empty row that
  opens straight away; an empty one disappears when closed. The input line at
  the top of a list is gone.
- Tasks can be selected: click selects, double click or Enter opens, arrow keys
  move the selection. When and Move in the bottom bar act on the selection.
- Search (button or `/`) finds areas, projects and open tasks and jumps to them.
- Projects, areas and headings get a `⋮` menu for their actions. A project's
  When, Deadline, Tags and area are set from that menu; under the title only
  what is set is shown.
- Task rows no longer have a delete cross: select a task and press Backspace
  or Delete, or use Delete in the open task.
- Settings open in a window with tabs (General, Account, Connections, About)
  from the button at the bottom of the sidebar; `/account` opens it too.
- The sidebar ends with "New List" (project or area) and the settings button.
- New icons: a sun for Today and a shrugging person for Someday.

## 0.1.0 (first test release)

- Lists: Inbox, Today with This Evening, Upcoming, Anytime,
  Someday and Logbook.
- Areas, projects, headings and nested tags, with drag and drop.
- When dates and deadlines; repeating tasks on a schedule or after completion.
- Checklists and notes per task.
- Offline-first web app with a local replica and sync.
- Accounts with API tokens; registration closed after the first user unless
  `DINGEN_REGISTRATION=open`.
- MCP server over Streamable HTTP (`/mcp`) and stdio.
- TickTick import from a backup CSV.
- Resizable sidebar with collapsible areas.
- Interface in English and Dutch.
- Docker image for linux/amd64 and linux/arm64 on GitHub Container Registry (`ghcr.io/kleijnict/dingen`).
