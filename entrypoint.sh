#!/bin/sh
# Runs the app as PUID:PGID (Unraid default 99:100 = nobody:users) and makes sure
# the mounted data directory belongs to that user, so a host folder can be bind-mounted.
set -e
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-99}"
  PGID="${PGID:-100}"
  # Only touch files whose ownership is wrong (cheap, and leaves correct files alone).
  find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null || true
  chmod u+rwx "$DATA_DIR"
  umask "${UMASK:-002}"
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi

# Started with --user already: just check we can write.
if ! [ -w "$DATA_DIR" ]; then
  echo "ERROR: $DATA_DIR is not writable by uid $(id -u). Fix the host folder's permissions or run without --user and set PUID/PGID." >&2
  exit 1
fi
exec "$@"
