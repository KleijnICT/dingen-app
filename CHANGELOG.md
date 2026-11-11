# Changelog

## Unreleased

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

## 0.1.1

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
