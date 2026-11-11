# Roadmap

Where Dingen is heading. Phases, not dates: each phase starts when the
previous one is done. Plans per part are in `docs/` (in Dutch).

## 1. Feature complete

- Times of day and reminders (web push)
- Export and import of all your data (JSON), also to move between servers
- Calendar events (ICS, CalDAV) shown in Today and Upcoming, read-only
- More importers besides TickTick (Todoist, CSV and others)
- An installable, mobile-friendly web app (PWA) that works offline
- A data model ready for sharing areas and projects later

## 2. Self-hosted 1.0

- A stable, versioned sync protocol and MCP server
- PostgreSQL as an alternative to SQLite
- Administration in the app: users, registration, backups, password reset
- Two-factor authentication (TOTP)
- A website with documentation

## 3. Home Assistant

- A Home Assistant add-on with Dingen in the sidebar
- An integration: lists as to-do entities, sensors and actions for
  automations

## 4. Hosted

- A hosted service in the EU, next to self-hosting, with a free trial
- The same features as self-hosted; you pay for not having to run it
- Moving between hosted and self-hosted in both directions via export
- OAuth for the MCP server, so Dingen works as a connector in Claude
- Capture by e-mail to the Inbox

## 5. Native apps

In this order: Android; iOS, iPadOS and macOS; Linux; a terminal app for
macOS and Linux; Windows. Native per platform, open source, working with any
Dingen server, with push notifications through a relay.

## Later

Sharing areas and projects with other people, attachments.
