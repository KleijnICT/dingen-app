# Dingen

Takenapp met het model en de workflow van Things. Open source, web-based,
self-hosted via Docker (en later ook hosted in de EU).

## Starten

```sh
docker compose up
```

De app draait daarna op http://localhost:8080. Alle data staat in één
SQLite-bestand op het volume `dingen-data` (`/data/dingen.db` in de container).

## Ontwikkelen

```sh
pnpm install
pnpm build      # bouwt core, server en web
pnpm dev        # server op :8080, web op :5173 met proxy naar de API
pnpm check      # lint, build, typecheck en tests
```

Besluiten en plannen per onderdeel staan in `docs/`.
