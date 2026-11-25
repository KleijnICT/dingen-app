# Roadmap

Where Dingen is heading. Phases, not dates: each phase starts when the
previous one is done, with an exception now and then.

## Now: the beta

Phases 1 and 2 are done, and Dingen is in beta: 1.0.0-beta.2 is out. What the
beta promises:

- The sync protocol (4) stays compatible until 2.0: it only grows, with new
  optional fields and new entity types. Apps you install now keep syncing.
- Every release migrates databases from every earlier release, with a backup
  first.
- The MCP tools may still change until 1.0.

Version 1.0.0 follows after the beta.

Done ahead of its phase: the Home Assistant app (phase 5), with Dingen in the
Home Assistant sidebar.

## 1. Feature complete (done)

- Reminders at an exact time (web push), dayparts and durations
- Export and import of all your data (JSON), also to move between servers
- Calendar events (ICS feeds) shown in Today and Upcoming, read-only
- Importers from other task apps and a generic CSV
- An installable, mobile-friendly web app (PWA) that works offline
- A data model ready for sharing areas and projects later

## 2. Self-hosted 1.0 (done)

- A stable, versioned sync protocol and MCP server
- Administration in the app: users, registration, backups, password reset
- Two-factor authentication (TOTP)
- A website with documentation

## 3. Native apps

In development, in parallel: Android; iOS, iPadOS and macOS; Linux; a
terminal app for macOS and Linux; Windows. Native per platform, open source,
working with any Dingen server.

- The first version of each app is for daily use: sign in to a server, work
  offline, all lists, areas and projects, and tasks with dates, repeats,
  checklists and tags. Reminders are scheduled on the device.
- Every app is built against the same specification and test set, in
  [spec/](spec/README.md), so they behave like the web app.
- After the first version: review, calendar events, quick capture from other
  apps, push notifications through a relay, and location reminders (a
  notification when you arrive at or leave a place).

## 4. Sharing

Sharing areas and projects with other people, in the web app and the native
apps at once.

## 5. Home Assistant

- A Home Assistant app (add-on) with Dingen in the sidebar (available)
- An integration: lists as to-do entities, sensors and actions for
  automations

## 6. Hosted

- A hosted service in the EU, next to self-hosting, with a free trial
- PostgreSQL as an alternative to SQLite
- The same features as self-hosted; you pay for not having to run it
- Moving between hosted and self-hosted in both directions via export
- OAuth for the MCP server, so Dingen works as a connector in Claude
- Capture by e-mail to the Inbox

## Later

Attachments, CalDAV calendars.
