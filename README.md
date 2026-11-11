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
- **Dates:** a "when" date for planning and a separate deadline.
- **Repeating tasks:** on a schedule or after completion, with weekdays, end
  dates and deadlines.
- **Checklists and notes** on every task.
- **Offline-first web app:** every browser keeps a local replica and syncs when
  it is back online.
- **Multi-user accounts** with API tokens.
- **MCP server** built in (`/mcp`, Streamable HTTP) and as a stdio command.
- **TickTick import** from a TickTick backup (CSV).
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

Open http://localhost:8080. **The first visitor creates the first account**;
after that, registration is closed. Create your account right after starting
the container, before exposing it to anyone else.

The image is built for `linux/amd64` and `linux/arm64`.

## Configuration

| Variable              | Default            | Meaning                                                                     |
| --------------------- | ------------------ | --------------------------------------------------------------------------- |
| `PORT`                | `8080`             | Port the server listens on inside the container.                            |
| `DATA_DIR`            | `/data`            | Directory for the SQLite database (`dingen.db`).                            |
| `DINGEN_REGISTRATION` | closed             | Set to `open` to let anyone create an account. Default: only the first one. |
| `DINGEN_TIMEZONE`     | `Europe/Amsterdam` | Time zone that decides what "today" is for the MCP server, and on which day and at what time calendar appointments are shown. |

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

### Development builds

Every push to the `develop` branch publishes `ghcr.io/kleijnict/dingen:develop`
(and `sha-<commit>`). Use it to try changes before they are released; it can
break. Releases are `latest` and the version tags.

## Updating

```sh
docker compose pull
docker compose up -d
```

Database migrations run automatically at start-up. Make a backup first.

## Backups

All data lives in one SQLite file, `/data/dingen.db`, on the `dingen-data`
volume. To copy it out safely while the container runs:

```sh
docker compose exec -w /app/apps/server dingen node -e \
  "new (require('better-sqlite3'))('/data/dingen.db').backup('/data/backup.db').then(()=>console.log('ok'))"
docker compose cp dingen:/data/backup.db ./dingen-backup.db
```

To restore, stop the container and put a backup back as `/data/dingen.db`.

## Connecting Claude (MCP)

Sign in, open **Settings** (bottom left) → **Connections** and create an API token (it starts with `dgn_`).

**Claude Code plugin** (recommended): connects the MCP server and adds a skill
that teaches Claude how Dingen works (capture to the Inbox, when-dates
versus deadlines, repeating on a schedule or after completion).

```
/plugin install dingen --marketplace KleijnICT/dingen-app
```

Claude Code asks for your Dingen URL (for example `https://dingen.example.com`)
and the API token when you enable the plugin; the token is kept in Claude
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

API tokens only work for the API and MCP; the `/mcp` endpoint never accepts a
browser session.

## Importing from TickTick

Generate a backup in TickTick (in the web app: Settings, Account, Backup &
Restore), then:

```sh
docker compose cp ticktick-backup.csv dingen:/tmp/ticktick.csv
docker compose exec -e DINGEN_TOKEN=dgn_... dingen \
  node packages/mcp/dist/import/cli.js ticktick /tmp/ticktick.csv \
  --url http://localhost:8080
```

Without `--apply` this is a dry run that prints what would be imported. Add
`--apply` to write it. Running the import again does not create duplicates.
Folders become areas, lists become projects, and the TickTick inbox becomes
the Inbox. Times of day, reminders and completed tasks are not imported.

## Known limitations

- Web only; native apps for Android and macOS are planned in separate
  repositories.
- No export or backup button in the app yet (see Backups above).
- No reminders or times of day.
- No shared projects or teams.
- MCP over HTTP needs an API token; OAuth for claude.ai connectors is not
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

The repository is a pnpm monorepo:

- `packages/core`: data model, sync protocol, dates and repeat rules
- `packages/mcp`: MCP server and import tools
- `apps/server`: Hono server with SQLite (Drizzle)
- `apps/web`: React web app with a local replica (Dexie)

Design decisions and plans per part are in `docs/` (in Dutch). See
[CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[GPL-3.0](LICENSE)
