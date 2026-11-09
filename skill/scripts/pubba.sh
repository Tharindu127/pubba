#!/usr/bin/env sh
# Runs the pubba CLI: the project's own install first, then a checkout named by PUBBA_HOME, then npx.
set -e
if [ -x "./node_modules/.bin/pubba" ]; then
  exec ./node_modules/.bin/pubba "$@"
elif [ -n "$PUBBA_HOME" ] && [ -f "$PUBBA_HOME/dist/cli.js" ]; then
  exec node "$PUBBA_HOME/dist/cli.js" "$@"
elif [ -n "$PUBBA_HOME" ] && [ -f "$PUBBA_HOME/src/cli.ts" ]; then
  exec node --experimental-strip-types --no-warnings "$PUBBA_HOME/src/cli.ts" "$@"
else
  exec npx --yes pubba "$@"
fi
