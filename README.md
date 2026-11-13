# Dingen

A task manager for a GTD-style way of working: Inbox, Today, Upcoming,
Anytime, Someday and Logbook, with areas, projects, headings, tags, deadlines,
repeating tasks and checklists. Open source, web-based and self-hosted with
Docker. Claude (or any MCP client) can read and manage your tasks through the
built-in MCP server.

> **Status: early test release (0.1).** Dingen is used daily by its author but
> is young. Back up your data volume, expect rough edges, and please
> [report what you run into](https://github.com/KleijnICT/dingen-app/issues).

## Features

- **Structure:** Inbox, Today (with This Evening), Upcoming,
  Anytime, Someday, Logbook; areas, projects, headings and nested tags.
- **Logbook as activity:** everything that was added, completed, changed or
  deleted, by you or by an agent, newest first and per day; filter on kind,
  who and period. "Completed" keeps the list of completed items.
- **Dates:** a "when" date for planning and a separate deadline.
- **Times and reminders:** a time of day on a task and a reminder, delivered
  as a notification on every device where you turn it on (web push).
- **Repeating tasks:** on a schedule or after completion, with weekdays, end
  dates and deadlines.
- **Checklists and notes** on every task.
- **Offline-first web app:** every browser keeps a local replica and syncs when
  it is back online.
- **Multi-user accounts**, and **agents** as members: each with its own token,
  scope and level, assignable tasks, and their changes on record.
- **MCP server** built in (`/mcp`, Streamable HTTP) and as a stdio command.
- **Imports** from TickTick (backup CSV), Todoist (CSV export) and a generic CSV.
- **Calendars (read-only):** subscribe to ICS feeds; appointments appear in
  Today and Upcoming. The server fetches them, so feed URLs stay private.
- Interface in English and Dutch.

## Quick start

With Docker Compose, save this as `compose.yml`:

```yaml
services:
  dingen:
    image: ghcr.io/kleijnict/dingen:latest
    ports:
      - "8080:8080"
    environment:
      DINGEN_TIMEZONE: Europe/Amsterdam
    volumes:
      - dingen-data:/data
    restart: unless-stopped

volumes:
  dingen-data:
```

```sh
docker compose up -d
```

Or with plain Docker:

```sh
docker run -d --name dingen -p 8080:8080 -v dingen-data:/data ghcr.io/kleijnict/dingen:latest
```

Open http://localhost:8080. **The first visitor creates the first account**
and becomes the administrator; after that, registration is closed. Create your
account right after starting the container, before exposing it to anyone else.

The image is built for `linux/amd64` and `linux/arm64`.

## Configuration

| Variable              | Default            | Meaning                                                                 |
| --------------------- | ------------------ | ----------------------------------------------------------------------- |
| `PORT`                | `8080`             | Port the server listens on inside the container.                        |
| `DATA_DIR`            | `/data`            | Directory for the SQLite database (`dingen.db`).                        |
| `DINGEN_REGISTRATION` | `closed`           | Who may register after the first account: `closed`, `invite` or `open`. |
| `DINGEN_TIMEZONE`     | `Europe/Amsterdam` | Time zone for "today" in the MCP, calendar appointments and reminders.  |

### Inviting people

`DINGEN_REGISTRATION=closed` (the default) allows only the first account,
`open` lets anyone register. With `invite`, the administrator (the first account)
invites others from **Settings → Invitations**: create a link, copy it and send
it to the person you mean. A link works once and expires after 14 days; open
links can be withdrawn. Whoever opens the link can create an account on your
server. The very first account never needs an invitation.

### Reminders (web push)

Reminders arrive as notifications through web push. Turn them on per device in
**Settings → General**. Browsers only allow this in a secure context: over
HTTPS (see below) or on `http://localhost`. Over plain HTTP on another address
the rest of Dingen works as usual, but reminders cannot be turned on. On an
iPhone or iPad, add Dingen to the home screen first (Share → Add to Home
Screen) and turn reminders on from there.

The server creates its push keys (VAPID) on first start and keeps them in the
database, so they survive updates and are part of your backup. Optional:

| Variable                   | Meaning                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `DINGEN_VAPID_SUBJECT`     | Contact for push services, `mailto:you@example.com` or an `https://` URL. |
| `DINGEN_VAPID_PUBLIC_KEY`  | Use your own key pair instead of the generated one (set both or neither). |
| `DINGEN_VAPID_PRIVATE_KEY` | Private key belonging to `DINGEN_VAPID_PUBLIC_KEY`.                       |

Changing the keys stops reminders on devices that were already subscribed;
turn them off and on again there.

### HTTPS and reverse proxies

Dingen speaks plain HTTP. For anything beyond your own machine, put it behind a
reverse proxy that terminates TLS (Caddy, Traefik, nginx) and forwards
`X-Forwarded-Proto: https`; session cookies are then marked `Secure`.

Example with Caddy:

```
dingen.example.com {
  reverse_proxy localhost:8080
}
```

### Home Assistant

Dingen also runs as a Home Assistant app (add-on), on Home Assistant OS or
Supervised: add the repository
[KleijnICT/dingen-app-ha-addon](https://github.com/KleijnICT/dingen-app-ha-addon)
and install Dingen. It opens in the Home Assistant sidebar and signs you in
with your Home Assistant user; every Home Assistant user gets their own lists.
Port 8080 can be given a host port for the installed web app, reminders and
MCP. The app uses this same image: when it finds `/data/options.json` (or
`DINGEN_HA=1`) it also listens on port 8099 for Home Assistant ingress and only
accepts the Supervisor there (`DINGEN_INGRESS_TRUSTED`, default
`172.30.32.2`). Each release shows up as an update in Home Assistant.

### Development builds

Every push to the `develop` branch publishes `ghcr.io/kleijnict/dingen:develop`
(and `sha-<commit>`). Use it to try changes before they are released; it can
break. Releases are `latest` and the version tags.

## Updating

```sh
docker compose pull
docker compose up -d
```

Database migrations run automatically at start-up. When an update brings new
migrations, Dingen first copies the database to
`/data/backups/dingen-<date>-<from>-<to>.db` (the ten most recent copies are
kept). If that copy fails, Dingen does not migrate and stops with a message in
the log.

## Backups

All data lives in one SQLite file, `/data/dingen.db`, on the `dingen-data`
volume. To copy it out safely while the container runs:

```sh
docker compose exec -w /app/apps/server dingen node -e \
  "new (require('better-sqlite3'))('/data/dingen.db').backup('/data/backup.db').then(()=>console.log('ok'))"
docker compose cp dingen:/data/backup.db ./dingen-backup.db
```

To restore, stop the container and put a backup back as `/data/dingen.db`.

You can also export from the app: **Settings → Data → Export all data** downloads
one JSON file with your areas, projects, tasks, tags and checklists (no tokens or
sessions). **Import** reads such a file into any Dingen account, also on another
server, which is the way to move between self-hosted and hosted. Items are matched
by id and merged, the most recent change per field wins, so importing the same
file twice changes nothing. The same is available over the API:
`GET /api/export` and `POST /api/import?mode=merge|reject` (`reject` refuses when
the account already has data).

The file (format version 2) holds the spaces you own, your personal space and
shared spaces you made, not spaces you are only a member of:
`{ format: "dingen-export", version: 2, appVersion, exportedAt, spaces: [{ id, kind }],
entities: { <type>: [{ id, spaceId, data, fieldTs }] } }`. On import an item that
is already on the server keeps its space; when it is in a space where you may
not edit (or cannot see), it is skipped. A new item goes back to its space when
you may edit there; on another server your personal space takes the place of
the exported one, and an exported shared space becomes a new shared space with
the same id, owned by you, so importing again finds it. Otherwise an item goes
to the space of its project, area, heading or task when you may edit there,
else to your personal space; files of version 1 (no spaces) are placed that
way too. Tags with the same name in one space become one tag. The answer is
`{ mode, counts: { <type>: { created, updated, unchanged, skipped } }, total, seq }`.

## Connecting Claude (MCP)

Sign in, open **Settings** (bottom left) → **Agents** and create an agent: a
name, an icon and a colour, and what it may reach (see [Agents](#agents)). Dingen
shows its token once (it starts with `dgn_`); that token is what you give Claude.

**Claude Code plugin** (recommended): connects the MCP server and adds a skill
that teaches Claude how Dingen works (capture to the Inbox, when-dates
versus deadlines, repeating on a schedule or after completion).

```
/plugin install dingen --marketplace KleijnICT/dingen-app
```

Claude Code asks for your Dingen URL (for example `https://dingen.example.com`)
and the agent's token when you enable the plugin; the token is kept in Claude
Code's secure credential store. On older Claude Code versions, run
`/plugin marketplace add KleijnICT/dingen-app` and then
`/plugin install dingen@dingen`.

**Over HTTP**, for Claude Code without the plugin:

```sh
claude mcp add --transport http dingen https://dingen.example.com/mcp \
  --header "Authorization: Bearer dgn_..."
```

**Over stdio**, for clients that start a local command (such as Claude
Desktop), using the same image:

```json
{
  "mcpServers": {
    "dingen": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "DINGEN_URL=https://dingen.example.com",
        "-e",
        "DINGEN_TOKEN=dgn_...",
        "ghcr.io/kleijnict/dingen:latest",
        "node",
        "packages/mcp/dist/stdio.js"
      ]
    }
  }
}
```

The MCP server offers tools to get an overview, list, search, create, update,
complete, reopen, cancel and delete tasks, and to create areas, projects,
headings and tags. Renaming or deleting areas, projects and tags is left to
the app.

`get_activity` reads the Logbook: what was added, completed, reopened,
changed or deleted, by whom and when, newest first. It filters on `kinds`,
`who` (`owner`, `me`, an agent's name or a member id) and a period (`since`,
`until`: `today`, `yesterday`, a date or a date-time), and pages with
`before`. An agent only sees activity on what it can read. The same data is
`GET /api/activity?kinds=…&actor=…&since=…&until=…&before=…&limit=…`, which
returns `{ items, nextBefore }`; changes to the same item by the same member
within five minutes are one line, and notes only say that they changed.

For the daily, weekly and monthly review there are `get_review` (what is due,
the steps and the items of the current step with their signals),
`start_review`, `mark_reviewed` (a project or area), `complete_review_step`
and `complete_review`. They share their progress with the app, so a review can
be started in one and finished in the other. Project and area output includes
`reviewedAt` and the signals (no next action, deadline soon, long quiet, not
reviewed lately).

Agent tokens only work for the API and MCP; the `/mcp` endpoint never accepts a
browser session.

### Agents

An agent is a member of your Dingen, like a person would be: it has a name, an
icon and a colour, it can be assigned tasks, and the Logbook shows what it
did. Every agent has one token and its own access, made of scopes with a level
each:

| Scope      | Reaches                                                              |
| ---------- | -------------------------------------------------------------------- |
| Everything | All your areas, projects and tasks (never more than you)             |
| Inbox      | Tasks without project and area (also loose tasks in Today, Upcoming) |
| An area    | The area, its projects and their tasks                               |
| A project  | That project, its headings and tasks                                 |

| Level  | May                                                                      |
| ------ | ------------------------------------------------------------------------ |
| Read   | See what is in its scope                                                 |
| Edit   | Also create, change, complete and move tasks and checklist items         |
| Manage | Also create, change and delete projects, headings and areas in its scope |

The highest level over all scopes that reach something counts. An agent
never sees what is outside its scope: no tasks, and no titles of areas or
projects (tag names are always visible). Moving something to a place outside
the scope is refused. Only you create agents and change their access; an
agent with Manage cannot.

**Rotate** gives an agent a new token and stops the old one; **Revoke** stops
the agent for good, while its past changes stay attributed to it. Tokens from
before agents existed became agents with the same name, scope Everything and
level Manage, so existing connections keep working.

Agents with a narrower scope than Everything use the MCP; the sync API
(`/api/sync`), export, import, calendars and invitations need the scope
Everything and answer `403 agent_scope` otherwise. The API: `GET /api/members`,
`GET`/`POST /api/agents`, `PATCH`/`DELETE /api/agents/:id`,
`POST /api/agents/:id/token` (new token) and
`GET /api/access?type=area|project&id=…` (who reaches it, at which level).
Managing agents needs a browser session.

## Importing

All importers work the same way: `dingen-import <source> <file>` prints a dry
run, `--apply` writes it to a running Dingen server, and running it again does
not create duplicates. The examples below run inside the container; copy the
file in first with `docker compose cp`. Use an API token (`--token` or
`DINGEN_TOKEN`) of an agent with scope Everything and level Manage, and `--url`.

### TickTick

Generate a backup in TickTick (in the web app: Settings, Account, Backup &
Restore), then:

```sh
docker compose cp ticktick-backup.csv dingen:/tmp/ticktick.csv
docker compose exec -e DINGEN_TOKEN=dgn_... dingen \
  node packages/mcp/dist/import/cli.js ticktick /tmp/ticktick.csv \
  --url http://localhost:8080
```

Folders become areas, lists become projects, and the TickTick inbox becomes
the Inbox. Times of day, reminders and completed tasks are not imported.

### Todoist

Todoist no longer offers a JSON backup. Use either the backup (Settings,
Backups: a zip with one CSV per project; unzip it) or "Export as CSV" from a
single project's menu, then point the importer at the file or the folder:

```sh
node packages/mcp/dist/import/cli.js todoist ~/Downloads/todoist-backup/ \
  [--area "Name"] --url http://localhost:8080
```

Each file becomes a project (`Inbox.csv` becomes the Inbox), sections become
headings, subtasks become checklist items, comments are added to the notes of
the task above them, and "every ..." dates become repeating tasks. `--area`
puts all imported projects in one area. Priorities, completed tasks, times of
day and reminders are not imported. The export has no task ids, so a task you
rename in Todoist counts as a new one on the next run.

### Generic CSV

For anything else, make a spreadsheet with these English column names (only
`title` is required) and export it as CSV (comma or semicolon separated):

| Column     | Meaning                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `title`    | Task title                                                                                                                        |
| `notes`    | Notes                                                                                                                             |
| `project`  | Project name (created if needed)                                                                                                  |
| `area`     | Area name (created if needed); a project is placed in it                                                                          |
| `tags`     | Tag names separated by commas or semicolons                                                                                       |
| `when`     | `YYYY-MM-DD`, `today`, `tomorrow`, `someday`, `anytime` or `inbox`; empty means Inbox, or Anytime when there is a project or area |
| `deadline` | `YYYY-MM-DD`                                                                                                                      |
| `done`     | `yes`, `true`, `1` or `x` for a completed task                                                                                    |

```sh
node packages/mcp/dist/import/cli.js csv tasks.csv --url http://localhost:8080
```

An example file is in [examples/import-example.csv](examples/import-example.csv).

## Known limitations

- Web only; native apps for Android and macOS are planned in separate
  repositories.
- No shared projects or teams.
- MCP over HTTP needs an agent token; OAuth for claude.ai connectors is not
  supported yet.

## Development

Requirements: Node 24 or newer and pnpm (see `packageManager` in
`package.json`).

```sh
pnpm install
pnpm dev        # server on :8080, web on :5173 with a proxy to the API
pnpm check      # lint, build, typecheck and tests
```

Build and run the image from source with `docker compose -f compose.dev.yml up --build`.

### Demo mode

`DINGEN_DEMO=1` is meant for development servers and screenshots only. **On
every start it wipes the whole database**: all accounts, sessions, API tokens,
invitations, calendars and tasks. It then writes a fixed set of demo data with
dates relative to today, so every list is filled: Sam Rivera (a freelance web
designer, the administrator), Morgan Rivera (a teacher) and an empty account.
The sign-in screen shows a button per demo account that signs in without a
password. Never set it on a server with data you want to keep.

```sh
DINGEN_DEMO=1 DATA_DIR=/tmp/dingen-demo pnpm --filter @dingen/server dev
```

The repository is a pnpm monorepo:

- `packages/core`: data model, sync protocol, dates and repeat rules
- `packages/mcp`: MCP server and import tools
- `apps/server`: Hono server with SQLite (Drizzle)
- `apps/web`: React web app with a local replica (Dexie)

See [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md) and
[CHANGELOG.md](CHANGELOG.md).

### Sync API

Clients keep a local replica and sync it with three calls under `/api/sync`
(a session or a token with the scope Everything). Every piece of data lives in
a space: for now each account has one, its personal space. The server numbers
every change with one rising `seq`; a client keeps a cursor per space, the
highest `seq` it has seen there. `GET /api/health` reports the protocol as
`syncProtocol` (now `2`).

- `GET /api/sync/pull?cursor=<URL-encoded JSON {"<spaceId>": seq}>` answers
  `{ protocol, spaces, removed, cursor, hasMore }`. Each entry in `spaces` is
  a space of the user (`id`, `kind`, `level`) with its new `seq`, its
  `changes` after the cursor (oldest first) and `hasMore`. A space missing from
  the cursor (the first pull sends `{}`, or a space shared with you later)
  comes with `entities`, all its live entities, instead of changes: replace
  what you had for it. `removed` lists spaces from your cursor you are no
  longer a member of: drop their data. `cursor` is the full new cursor; pull
  again while `hasMore` (at most 500 changes per answer).
- `POST /api/sync/push` with `{ changes, cursor? }` answers
  `{ seq, applied, duplicates, cursor? }`. With your cursor, the answer's
  `cursor` holds the spaces where nothing but this push happened since, moved
  past it; merge it (highest per space) to skip pulling your own changes back.
- `GET /api/sync/snapshot[?space=<id>]` answers `{ protocol, entities, spaces,
  cursor, seq }`, every entity with its `spaceId`.

Moving between spaces. A change may carry `spaceId` (it is not an entity
field and never shows up in `data`):

- On a new entity it names the space it goes into. Without it, a new entity
  goes into the space of its project, area, heading or task, else into your
  personal space. A container in another space than the one named is refused
  (400).
- On an existing area, project or task it moves it there, with the same id
  and its history. Its children move along: an area with its projects and
  loose tasks, a project with its headings and tasks, a task with its
  checklist items and repeat instances. References to containers that stay
  behind become null (a task moved on its own is a loose task there), and
  tags become the target space's tag with the same name (compared in lower
  case), made there when missing. A move needs edit in both spaces (else 403
  `space_access`); an agent also needs edit on everything (else 403
  `agent_scope`). Headings, checklist items, tags and reviews do not move on
  their own (400).
- The push answer adds `placed: [{ entityType, id, spaceId }]` for every
  entity it created or moved (children and new tags included). A space where
  a move happened is never in the answer's `cursor`: pull it.
- A pull reports a move per space: `arrived` lists entities that are now in
  that space and within your reach, as whole records (put them as they are,
  with that space); `left` lists `{ entityType, id }` that went out of your
  sight (drop them). Apply both after `changes`. Moving between two of your
  spaces is an arrival only. Protocol 1 pulls get a deletion for `left` and
  the whole record as changes for `arrived`.

Protocol 1 still works for clients from 1.0.0-alpha.4 and older (a cached web
app, the MCP plugin): `GET /api/sync/pull?since=<seq>` answers
`{ changes, seq, hasMore }` over all your spaces. A stored protocol 1 cursor
moves over with `pull?cursor=<seq>` (a bare number counts for every space).
The `since` form will be removed once released clients no longer use it,
at the earliest with 1.0.

## License

[GPL-3.0](LICENSE)
