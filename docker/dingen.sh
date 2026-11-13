#!/bin/sh
# The `dingen` command in the image: backups from the command line, e.g.
#   docker compose exec dingen dingen backup
# `docker exec` runs as root: drop to `node` like the entrypoint, so new files
# in /data stay owned by the user the server runs as.
set -e

cli=/app/apps/server/dist/cli.js
if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all -- node "$cli" "$@"
fi
exec node "$cli" "$@"
