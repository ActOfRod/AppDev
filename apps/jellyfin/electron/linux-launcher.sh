#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${APPIMAGE:-}" ]; then
  set -- --no-sandbox "$@"
fi
exec "$directory/@EXECUTABLE@.bin" "$@"
