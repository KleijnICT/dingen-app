# Dingen specification

Everything a client needs to work with a Dingen server, without reading the
TypeScript code. Written for native clients in other languages.

| File                                  | What it is                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [protocol.md](protocol.md)            | The sync protocol (version 4): signing in, push, pull, snapshot, and the algorithm a client follows. |
| [entities.md](entities.md)            | Every entity type and field, with defaults and rules.                                                |
| [conformance/](conformance/README.md) | The test set: operations with their input and expected output, as JSON. A client must pass it.       |

## Rules for a client

- Build against these files. Where they are silent or unclear, that is a gap
  in the specification: report it, do not guess from the web app.
- The sync protocol only grows until 2.0: new optional fields with a default,
  new entity types. A client must ignore entity types it does not know and
  must keep fields it does not know.
- A client records which version of the test set it passes
  (`conformance/manifest.json`, `version`).

## How the files stay true

`conformance/*.json` is generated from `@dingen/core`
(`packages/core/src/conformance.test.ts`) and pinned in CI: a change in
behaviour fails the build until the files and the version are updated with
it. The shapes of the protocol are pinned the same way in
`apps/server/test/contract/sync-protocol.json`, which is the machine-readable
form (JSON Schema) of entities.md and of the requests and answers in
protocol.md.
