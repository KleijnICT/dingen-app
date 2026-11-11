#!/usr/bin/env bash
# Rolt een net gepusht image uit: roept de stack-webhook van de server aan en
# wacht tot /api/health de verwachte build meldt.
# Gebruik: deploy.sh <webhook-url> <health-url> <build>
# Zonder webhook-url (geen secret, bijvoorbeeld in een fork) slaat hij over.
set -euo pipefail
webhook="${1:-}"
health="$2"
build="$3"

if [ -z "$webhook" ]; then
  echo "Geen webhook ingesteld; uitrollen overgeslagen."
  exit 0
fi

echo "Webhook aanroepen voor build $build"
curl -fsS -X POST --max-time 60 "$webhook" -o /dev/null

deadline=$((SECONDS + 300))
while [ "$SECONDS" -lt "$deadline" ]; do
  current=$(curl -fsS --max-time 10 "$health" 2>/dev/null | sed -n 's/.*"build":"\([^"]*\)".*/\1/p' || true)
  if [ "$current" = "$build" ]; then
    echo "Live: $health meldt build $build"
    exit 0
  fi
  echo "Wachten (nu: ${current:-onbereikbaar})"
  sleep 10
done
echo "::error::$health meldt na 5 minuten nog niet build $build"
exit 1
