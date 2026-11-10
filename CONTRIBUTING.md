# Contributing

Dingen is an early test release. The most useful contribution right now is a
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

By contributing you agree that your contribution is licensed under GPL-3.0.
