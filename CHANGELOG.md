# Changelog

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
