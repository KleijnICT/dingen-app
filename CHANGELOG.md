# Changelog

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
