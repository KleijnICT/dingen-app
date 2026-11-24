#!/usr/bin/env bash
# Makes the test database of one release for the migration tests
# (migrations-from-alphas.test.ts): that release's own code seeds it (seed.ts)
# and the result is stored as an SQL dump, <version>.sql, next to this script.
#
# Usage, from the repository root, for example for 1.0.0-alpha.3:
#
#   tree=$(mktemp -d)
#   git archive v1.0.0-alpha.3 | tar -x -C "$tree"
#   apps/server/test/fixtures/alphas/generate.sh "$tree" 1.0.0-alpha.3
#   rm -rf "$tree"
#
# Needs pnpm and the sqlite3 command line tool. The dumps are committed; only
# run this again for a new release (add its version to the test) or when
# seed.ts gets more data.
set -euo pipefail

tree=${1:?release tree}
version=${2:?version}
here=$(cd "$(dirname "$0")" && pwd)
out="$here/$version.sql"
db="$tree/fixture.db"

(cd "$tree" && pnpm install --frozen-lockfile --prefer-offline --silent)
(cd "$tree" && pnpm --filter @dingen/core build >/dev/null && pnpm --filter @dingen/mcp build >/dev/null)
cp "$here/seed.ts" "$tree/apps/server/seed.ts"
rm -f "$db" "$db-wal" "$db-shm"
(cd "$tree/apps/server" && npx tsx seed.ts "$db" "$version")
{
  echo "-- Test database of Dingen $version, made by generate.sh with seed.ts."
  # Newer sqlite3 versions also dump the creation of sqlite_sequence, which cannot be run.
  sqlite3 "$db" .dump | grep -v '^CREATE TABLE IF NOT EXISTS sqlite_sequence('
} >"$out"
echo "Wrote $out"
