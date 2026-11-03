#!/bin/sh
# Run the egress self-check as the same unprivileged user/capabilities as the app.
cd /srv
if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid="${PUID:-99}" --regid="${PGID:-100}" --clear-groups \
    --inh-caps=-all --bounding-set=-all --no-new-privs python -m app.egress_check "$@"
fi
exec python -m app.egress_check "$@"
