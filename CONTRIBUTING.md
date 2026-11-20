# Contributing

Dingen is in beta (1.0.0-beta.1). The most useful contribution right now is a
clear issue: what you did, what you expected, what happened, and the version
(the image tag you run, or `version` from `/api/health`).

Dingen follows one way of working on purpose and keeps few settings.
Feature requests that add options are likely to be declined; requests that
make the existing workflow work better are welcome.

## Code

```sh
pnpm install
pnpm check   # must pass: lint (Biome), build, typecheck and tests (Vitest)
```

- Work on a branch from `develop`; `main` holds releases.
- Interface text and code comments are in English. Interface strings go
  through the translation files in `apps/web/src/i18n/`.
- Never put real personal data in tests, fixtures or commits.
- Changes to the web client follow [DESIGN.md](DESIGN.md): tokens only, one
  component per job, light and dark both.
- The sync protocol only grows until 2.0: new optional fields with a default
  and new entity types, nothing renamed, removed or made stricter. The
  contract test in `apps/server/test/contract/` fails on any change to it;
  update its snapshot only for an additive change.
- A change to the database schema is a new migration in
  `apps/server/drizzle/`; the migration tests run it on a database of every
  alpha release.

By contributing you agree that your contribution is licensed under GPL-3.0.
