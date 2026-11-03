#!/bin/sh
# Container start-up (runs as root, then drops to an unprivileged user):
#
#  1. Egress firewall inside the container's own network namespace (needs the
#     NET_ADMIN capability; nothing on the host or router is changed). Outbound
#     traffic may go to the public internet only, so it can never reach:
#       - the LAN, the Unraid host or other containers (private address ranges)
#       - the tailnet, e.g. via the HOST's Tailscale node (100.64.0.0/10,
#         fd7a:115c:a1e0::/48, MagicDNS 100.100.100.100), because packets are
#         dropped before they leave the container, so the host never routes them.
#  2. Makes the data folder (bind mount) belong to PUID:PGID.
#  3. Runs the app as PUID:PGID with every capability removed, so the app can't
#     change or remove the firewall rules.
set -e

DATA_DIR="${DATA_DIR:-/data}"
EGRESS_FIREWALL="${EGRESS_FIREWALL:-on}"     # on | off
EGRESS_DNS="${EGRESS_DNS:-1.1.1.1 9.9.9.9}"  # public resolvers the container uses
BLOCK4="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 198.18.0.0/15 224.0.0.0/4 240.0.0.0/4 0.0.0.0/8 ${EGRESS_EXTRA_BLOCKED:-}"

log() { echo "[entrypoint] $*"; }

pick_iptables() {
  for v in iptables iptables-legacy; do
    if command -v "$v" >/dev/null 2>&1 && "$v" -w -n -L OUTPUT >/dev/null 2>&1; then
      IPT="$v -w"; IP6T="$(echo "$v" | sed 's/iptables/ip6tables/') -w"; return 0
    fi
  done
  return 1
}

apply_firewall() {
  pick_iptables || return 1

  # DNS: use public resolvers (the host/router/MagicDNS resolvers are blocked).
  if [ -w /etc/resolv.conf ]; then
    { for ns in $EGRESS_DNS; do echo "nameserver $ns"; done; echo "options timeout:2 attempts:2"; } > /etc/resolv.conf
  fi

  # --- IPv4 outbound ---
  $IPT -N OUTINGS-OUT 2>/dev/null || $IPT -F OUTINGS-OUT
  $IPT -A OUTINGS-OUT -o lo -j ACCEPT
  $IPT -A OUTINGS-OUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  for net in $BLOCK4; do
    $IPT -A OUTINGS-OUT -d "$net" -j REJECT --reject-with icmp-admin-prohibited
  done
  $IPT -A OUTINGS-OUT -j ACCEPT
  $IPT -C OUTPUT -j OUTINGS-OUT 2>/dev/null || $IPT -I OUTPUT 1 -j OUTINGS-OUT

  # --- IPv4 inbound: only the web app's own port may be opened from private ranges
  # (that's how a published port arrives). Everything else from the LAN / other containers is dropped.
  $IPT -N OUTINGS-IN 2>/dev/null || $IPT -F OUTINGS-IN
  $IPT -A OUTINGS-IN -i lo -j ACCEPT
  $IPT -A OUTINGS-IN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  $IPT -A OUTINGS-IN -p tcp --dport "${UVICORN_PORT:-8000}" -j ACCEPT
  for net in $BLOCK4; do
    $IPT -A OUTINGS-IN -s "$net" -j DROP
  done
  $IPT -A OUTINGS-IN -j ACCEPT
  $IPT -C INPUT -j OUTINGS-IN 2>/dev/null || $IPT -I INPUT 1 -j OUTINGS-IN

  # --- IPv6: loopback and replies only (covers the tailnet's fd7a:... range too) ---
  if $IP6T -n -L OUTPUT >/dev/null 2>&1; then
    for ch in OUTPUT INPUT; do
      $IP6T -N "OUTINGS6-$ch" 2>/dev/null || $IP6T -F "OUTINGS6-$ch"
      if [ "$ch" = OUTPUT ]; then $IP6T -A "OUTINGS6-$ch" -o lo -j ACCEPT; else $IP6T -A "OUTINGS6-$ch" -i lo -j ACCEPT; fi
      $IP6T -A "OUTINGS6-$ch" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
      $IP6T -A "OUTINGS6-$ch" -j DROP
      $IP6T -C "$ch" -j "OUTINGS6-$ch" 2>/dev/null || $IP6T -I "$ch" 1 -j "OUTINGS6-$ch"
    done
  fi
  return 0
}

mkdir -p "$DATA_DIR"

if [ "$(id -u)" != "0" ]; then
  # Started with --user: we can't set up the firewall or drop privileges ourselves.
  if [ "$EGRESS_FIREWALL" = "on" ]; then
    echo "ERROR: EGRESS_FIREWALL=on needs the container to start as root (don't use --user; set PUID/PGID instead)." >&2
    exit 1
  fi
  [ -w "$DATA_DIR" ] || { echo "ERROR: $DATA_DIR is not writable by uid $(id -u)." >&2; exit 1; }
  exec "$@"
fi

if [ "$EGRESS_FIREWALL" = "on" ]; then
  if apply_firewall; then
    log "egress firewall active: internet only (LAN, host, other containers and tailnet blocked)"
  else
    echo "ERROR: could not set up the egress firewall. Give the container the NET_ADMIN capability" >&2
    echo "       (Unraid: Extra Parameters --cap-add=NET_ADMIN), or set EGRESS_FIREWALL=off to run without it." >&2
    exit 1
  fi
else
  log "WARNING: egress firewall disabled (EGRESS_FIREWALL=off)"
fi

# Optional: switch on Tailscale Funnel to the app automatically (TS_FUNNEL_PORT=8000).
# Waits in the background until Tailscale (e.g. Unraid's built-in integration) is
# running and logged in, then runs `tailscale funnel --bg <port>`, which Tailscale
# also remembers across restarts. Gives up after ~10 minutes.
if [ -n "${TS_FUNNEL_PORT:-}" ]; then
  (
    i=0
    while [ "$i" -lt 120 ]; do
      if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
        if out=$(tailscale funnel --bg "$TS_FUNNEL_PORT" 2>&1); then
          log "Tailscale Funnel on: public HTTPS -> http://127.0.0.1:$TS_FUNNEL_PORT"
          tailscale funnel status 2>/dev/null | sed 's/^/[entrypoint]   /' || true
          exit 0
        fi
        last="$out"
      fi
      i=$((i + 1)); sleep 5
    done
    log "WARNING: could not switch on Tailscale Funnel. Is Tailscale running and logged in in this container? ${last:-}"
  ) &
fi

PUID="${PUID:-99}"
PGID="${PGID:-100}"
# Give the app's files to PUID:PGID, but leave Tailscale's state (node private keys; Unraid's
# Tailscale integration may put it in /data/.tailscale_state) owned by root and unreadable
# by the app, so a compromised app can't steal the node's identity.
find "$DATA_DIR" -mindepth 1 -path "$DATA_DIR/.tailscale*" -prune -o \
  \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null || true
chown "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || true
for ts in "$DATA_DIR"/.tailscale*; do
  [ -e "$ts" ] || continue
  chown -R 0:0 "$ts" 2>/dev/null || true
  chmod -R go-rwx "$ts" 2>/dev/null || true
done
chmod u+rwx "$DATA_DIR"
umask "${UMASK:-002}"

# Drop to PUID:PGID with no capabilities at all (so iptables rules can't be changed).
exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups \
  --inh-caps=-all --bounding-set=-all --no-new-privs "$@"
