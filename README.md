# Reuben Boat Club — Outing Planner

A web app for planning boat-club outings. Admins look after the boat park and the squad, and build each week's water and land sessions. Rowers see the published schedule, ask for subs, and take open seats.

## Run it

```bash
cp .env.example .env        # then set ADMIN_PASSWORD, MEMBER_PASSWORD and SECRET_KEY
docker compose up -d --build
```

Then open http://localhost:8000. All data is stored in the host folder set by `DATA_PATH` (default `./data`), mounted at `/data` in the container. See *Hosting on Unraid* below.

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Password for admins/coaches (full access). Required. |
| `MEMBER_PASSWORD` | Password for rowers. Required, and must differ from the admin password. Admins can override it from **Settings** without redeploying. |
| `SECRET_KEY` | Signs session cookies. If unset, a key is generated and stored in `/data`. |
| `COOKIE_SECURE` | Set to `1` when serving over HTTPS (recommended, e.g. behind Caddy/Traefik/nginx). |
| `PUBLIC_URL` | Optional. The site's public address (e.g. `https://outings.example.org`), used in calendar-subscription links. Set it if those links show the wrong host behind your proxy. |
| `PHONE_KEY` | Encryption key for phone numbers (16+ characters, e.g. `openssl rand -base64 32`). Keep it outside the data folder and back it up separately. Without it, phone numbers aren't collected. |
| `PHONE_KEY_OLD` | Only when changing the key: the previous key, for one restart, so stored numbers get re-encrypted with the new one. |
| `EGRESS_FIREWALL` | `on` (default) restricts the container to the public internet only (see the Tailscale Funnel section). Needs `NET_ADMIN`. Set `off` to disable. |
| `TS_FUNNEL_PORT` | Optional, e.g. `8000`. When Tailscale runs inside the container, waits until it's logged in, then runs `tailscale funnel --bg <port>` so the site goes public automatically. |
| `EGRESS_DNS` | DNS servers used when the firewall is on (default `1.1.1.1 9.9.9.9`). |
| `EGRESS_EXTRA_BLOCKED` | Extra address ranges to block, e.g. if your LAN uses non-private addresses. |
| `TZ_NAME` | Club time zone (default `Europe/London`). Used to decide "today". |

**First run:** sign in as admin, go to **Settings → Import from spreadsheet**, and upload `Rowing_Outings.xlsx`. This brings in the members, coaches and term settings. Then add your fleet under **Boat park**.

## Hosting on Unraid (data in one folder)

Everything the app stores lives in one folder inside the container, `/data`:

| File | What it is |
|---|---|
| `outings.db` (+ `-wal`/`-shm` while running) | The SQLite database: members, boats, sessions, sign-ups, settings |
| `.secret_key` | Signs login cookies, so people stay signed in across restarts |
| `backup.db` | Written when an admin downloads a backup |

Map a host folder to `/data`, e.g. `/mnt/user/appdata/outing-planner`. When the container starts, it gives that folder to `PUID:PGID` (default `99:100`, Unraid's `nobody:users`) and runs the app as that user, so you don't need to set permissions yourself.

**Option A: Docker Compose (Compose Manager plugin, or the Unraid terminal)**

```bash
# copy this project folder to e.g. /mnt/user/appdata/outing-planner-src, then:
cd /mnt/user/appdata/outing-planner-src
cp .env.example .env      # set the passwords, SECRET_KEY, and:
#   DATA_PATH=/mnt/user/appdata/outing-planner
#   PUID=99
#   PGID=100
docker compose up -d --build
```

**Option B: Unraid Docker tab (“Add Container”)**

First build the image on the server (`docker build -t outing-planner:latest .` in the project folder), or push it to a registry such as Docker Hub or GHCR. Then add a container with:

- Repository: `outing-planner:latest` (or your registry image)
- Port: container `8000` → host port of your choice
- Path: container `/data` → host `/mnt/user/appdata/outing-planner`
- Variables: `ADMIN_PASSWORD`, `MEMBER_PASSWORD`, `SECRET_KEY`, `PUID=99`, `PGID=100`, and `PUBLIC_URL` / `COOKIE_SECURE=1` if it's served over HTTPS
- Extra Parameters: `--cap-add=NET_ADMIN` (needed for the built-in egress firewall; see the Tailscale Funnel section below)

**Backups**: back up the whole folder. For a copy that's safe to take while the app is running, use **Settings → Data → Download database backup** in the app. If you copy `outings.db` by hand, stop the container first (or copy the `-wal` file along with it).

## Public access with Tailscale Funnel on Unraid, isolated from your network

The goal: the site is public through Tailscale Funnel, but the container can't reach the LAN, the Unraid host, other containers, or anything on the tailnet. All of this is set up **inside the container**: no firewall rules on the host and no router changes.

**How it's isolated**

1. **Egress firewall inside the container** (`entrypoint.sh`, on by default). At start-up the container sets firewall rules in its *own* network namespace. Outgoing traffic may go to the public internet only. Private ranges (LAN, Unraid host, other containers), `100.64.0.0/10` / `fd7a:115c:a1e0::/48` (Tailscale) and MagicDNS are rejected *before the packet leaves the container*. So the host never routes anything into its own Tailscale, and nothing can show up on the tailnet as the host's node. Incoming connections from private ranges are dropped too, except to the app's own port (8000), so a published port still works if you use one. DNS goes to public resolvers (`EGRESS_DNS`, default `1.1.1.1 9.9.9.9`). The app then runs as `PUID:PGID` with **no capabilities**, so it can't change the rules. This needs the `NET_ADMIN` capability, which only affects the container's own namespace, not the host. If the firewall can't be set up, the container refuses to start (set `EGRESS_FIREWALL=off` to override).
2. **Tailscale access controls** for the container's *own* Tailscale node. Its tailnet traffic leaves inside an encrypted tunnel, so the firewall can't see it. Tag the node `tag:outings` and give that tag no rules as a source: see `unraid/tailscale-policy-snippet.hujson`. Funnel still works, because it's incoming public traffic.

**Unraid container settings**

| Setting | Value |
|---|---|
| Network Type | **bridge** (not host, none or container; see below) |
| Port mappings | **none.** Remove the 8000 mapping; the site is only reached through Funnel |
| Path | container `/data` → host `/mnt/user/appdata/outing-planner` |
| Extra Parameters | `--cap-add=NET_ADMIN` |
| Variables | `ADMIN_PASSWORD`, `MEMBER_PASSWORD`, `SECRET_KEY`, `PUID=99`, `PGID=100`, `COOKIE_SECURE=1`, `PUBLIC_URL=https://<hostname>.<your-tailnet>.ts.net` |
| Use Tailscale | Yes, with a hostname such as `outings`. Turn on **userspace networking** if offered, and **Funnel** to port `8000`. Don't use an exit node, and don't allow LAN access |

- **Network type:** `host` would put the container's firewall rules on the *host*, and it could see the host's Tailscale interface. `none` has no internet, so Tailscale can't connect. `container:` makes the isolation depend on another container. `bridge` gives the container its own namespace behind the host's NAT.
- **Tailscale node:** when it first joins, give the node the tag `tag:outings` in the admin console (or use a tagged auth key). Funnel needs HTTPS certificates and MagicDNS turned on for the tailnet.
- **Host exit node:** if the Unraid *host* uses a Tailscale exit node, all of its internet traffic (including the container's) goes out through that exit node. That can only be changed on the host.

**Check it on the server**

```bash
docker logs outing-planner | grep entrypoint     # "egress firewall active ..."
docker exec outing-planner egress-check <unraid-LAN-IP> <unraid-tailscale-IP>
```
Every private, LAN and Tailscale target should show `BLOCKED`, the internet checks `OK`, and the result `ALL GOOD`.

## Features

- **Boat park**: admins add and edit boats (type, seats, coxed, rigging, notes). Each boat is *available*, *under repair* or *retired*. Retired boats are hidden from the session editor, and the editor warns when a boat under repair is picked or a boat is booked twice at the same time.
- **Weekly schedule**: admins create water outings (pick a boat, which sets the seats) and land sessions. Seats are filled with a searchable picker that shows each person's eligibility. Admins can copy the previous week (with or without crews) and keep a week as a draft until they **Publish** it to rowers.
- **Weekly sign-up** (replaces the Google Form): under **Sign-ups**, admins list the week's water, erg and tank sessions (or copy last week's), add an optional message, and open the form. Rowers give their name (picked from the list, or typed in full to add themselves as a new member flagged *New* for an admin to check), phone number, college (Reuben, Blackfriars, St Stephen's House or other), whether they're signing up as a rower, cox, both or bankrider/coach, how many rowing and coxing outings they want, side preference, the most outings they'll do that week, which sessions they're free for, and whether they can bankride. Sending the form again updates their answers. Admins see the responses, a people × sessions availability grid and per-session counts, and can export everything as CSV. **Create session** on a slot opens the outing editor already filled in, and the seat picker lists people who are free for that time first, with their side preference and how many outings they've been given out of their weekly maximum.
- **Crew picking**: the session editor shows a **Signed up** panel next to the seats, listing everyone who said they're free for that session, grouped as coxes, rowers and people who can bankride. Fewest outings this week come first, and you can see side preference and how many outings each person has been given out of their weekly maximum. Click a name to put them in the boat (coxes go to the cox seat, and rowers go to their side: stroke side is the even seats, bow side the odd ones). Click it again to take them out, or click a seat's name first to choose exactly where the next person goes. People who signed up for other sessions that week are listed underneath.
- **Calendar subscription**: **Add to calendar** (on the schedule and on My outings) gives each person a private feed link for Apple Calendar, Google Calendar, Outlook or any app that can subscribe to a calendar. It contains every published outing they're in, plus sessions where they're named as coach or bankrider, with the time, place, boat, coach, crew list and notes. Calendar apps re-check the feed by themselves, so changes, subs and new sessions flow through. Outings with no recognisable time show as all-day events. A person can get a new link to stop an old one working. Google Calendar only refreshes subscribed calendars every few hours, and it needs the site to be reachable from the internet.
- **Phone numbers are protected**:
  - **Rowers can't see them:** no page or data request available to rowers ever includes them.
  - **Encrypted in the database:** encrypted with `PHONE_KEY`, so the database file, Unraid backups and "Download database backup" contain no readable numbers. Deleted or replaced values are overwritten with zeros, so old copies don't linger in the file.
  - **Masked for admins:** admin screens show only the last 3 digits. The full number is fetched when an admin taps **Show**.
  - **Left out of exports by default:** CSV exports include numbers only if the admin ticks the box.
  - **Deleted automatically:** a number is removed once its owner hasn't signed up for a set number of days (default 180, in **Settings → Phone numbers**). Admins can also delete one by hand.
  - **Configurable:** the form can make the number required, optional, or not ask for it at all.
- **Subs**: a rower taps **Can't go** on their own seat to post a request to the **Sub board**. Another rower takes it with **I'll sub**, and the seat and the outing count move to them. People who aren't eligible (no swim test, unpaid after the cutoff, double-booked, not a cox for the cox seat) are blocked from taking a seat.
- **Rowers database**: Novice/Senior category, swim test, subs plan, cox status (N/X/S), and water/land outing totals. Totals are worked out from the schedule plus a baseline of earlier outings, so there's no weekly roll-over to do. Admins can export members as CSV.
- **Coaches**: sessions per coach per month, matched on the Coach/bankrider field (with an optional short "text to find", like the spreadsheet).

### Rules (taken from the spreadsheet)

- Subs are valid for a *Full year* plan that matches the current academic year, or a *Single term* plan that matches the current term and year. Anyone can row up to and including the **subs cutoff date**.
- Water needs a swim test.
- A **novice** gets N free water outings (default 4) that need no swim test and no subs. Cox seats count as water outings. While a novice still has free outings left, land training is free too (this can be switched off).
- Eligibility is checked for each session using that session's date and the person's running water count up to it.
- A novice cox (status N) with no coach/bankrider set gets flagged **Bankrider needed**.

## Notes

- The shared passwords decide whether someone is an admin or a rower. Rowers pick their own name ("Who are you?"), and the app remembers it on that device. There are no individual accounts, so a rower could pick someone else's name. That's normal for a shared-password club tool.
- Rowers never see payment or swim-test status. Only admins do.
- Back up the database from **Settings → Data**, or copy the volume.

## Local development

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
ADMIN_PASSWORD=admin123 MEMBER_PASSWORD=rower123 DATA_DIR=./data .venv/bin/uvicorn app.main:app --reload
```
