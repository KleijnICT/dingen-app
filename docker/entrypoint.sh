#!/bin/sh
# Starts the server as `node`. Home Assistant mounts /data owned by root and
# starts the container as root: then fix the ownership once and drop to node.
# Started as another user (docker run --user ...), just run the command.
set -e

if [ "$(id -u)" = "0" ]; then
  data="${DATA_DIR:-/data}"
  mkdir -p "$data"
  if [ -n "$(find "$data" ! -user node -print -quit 2>/dev/null)" ]; then
    echo "Making $data owned by node"
    chown -R node:node "$data"
  fi
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all -- "$@"
fi

exec "$@"
