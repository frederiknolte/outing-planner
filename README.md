# Reuben Boat Club — Outing Planner

A web app for planning boat-club outings. The committee looks after the boat park and the squad, and build each week's water and land sessions. Rowers see the published schedule, ask for subs, and take open seats.

## Run it

```bash
cp .env.example .env        # then set COMMITTEE_PASSWORD, MEMBER_PASSWORD and SECRET_KEY
docker compose up -d --build
```

Then open http://localhost:8000. All data is stored in the host folder set by `DATA_PATH` (default `./data`), mounted at `/data` in the container. See *Hosting on Unraid* below.

| Variable | Purpose |
|---|---|
| `COMMITTEE_PASSWORD` | Password for the committee (full access). Required. |
| `MEMBER_PASSWORD` | Password for rowers. Required, and must differ from the committee password. The committee can override it from **Settings** without redeploying. |
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

**First run:** sign in with the committee password, check the term dates under **Settings**, add the fleet under **Boat park**, and add members under **Rowers** (rowers can also add themselves through the weekly sign-up form).

## Hosting on Unraid (data in one folder)

Everything the app stores lives in one folder inside the container, `/data`:

| File | What it is |
|---|---|
| `outings.db` (+ `-wal`/`-shm` while running) | The SQLite database: members, boats, sessions, sign-ups, settings |
| `.secret_key` | Signs login cookies, so people stay signed in across restarts |
| `backup.db` | Written when a committee member downloads a backup |
| `photos/` | Photos attached to boat issues (not included in the database backup) |

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
- Variables: `COMMITTEE_PASSWORD`, `MEMBER_PASSWORD`, `SECRET_KEY`, `PUID=99`, `PGID=100`, and `PUBLIC_URL` / `COOKIE_SECURE=1` if it's served over HTTPS
- Extra Parameters: `--cap-add=NET_ADMIN` (needed for the built-in egress firewall; see the Tailscale Funnel section below)

**Backups**: back up the whole folder (it includes `photos/`). For a copy that's safe to take while the app is running, use **Settings → Data → Download database backup** in the app. If you copy `outings.db` by hand, stop the container first (or copy the `-wal` file along with it).

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
| Variables | `COMMITTEE_PASSWORD`, `MEMBER_PASSWORD`, `SECRET_KEY`, `PUID=99`, `PGID=100`, `COOKIE_SECURE=1`, `PUBLIC_URL=https://<hostname>.<your-tailnet>.ts.net` |
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

- **Boat park**: the committee adds and edits boats (type, seats, coxed, rigging, notes). Each boat is *available*, *under repair* or *retired*. Retired boats are hidden from the session editor, and the editor warns when a boat under repair is picked or a boat is booked twice at the same time.
- **Boat usage** (Boat park → *Usage*, everyone can see it): outings and hours on the water per boat for this season, this term, the last 30 days or all time, with when each boat was last used and what's booked next. A water outing counts once it has happened (published, not cancelled, before today); hours come from its start and end time, or 90 minutes when there's no end time (the page says how many were assumed). Available boats with no outing in 30 days and nothing booked are marked **Idle**. For servicing, the committee records each boat's **last serviced** date and can set a **service interval** in hours: the page shows hours and outings since the last service and flags boats that are **due**.
- **Boat issues** (Boat park → *Issues*): anyone can report a problem with a boat (what's wrong, how serious: *Minor*, *Use with care* or *Do not use*, a description and photos), and anyone can add notes and more photos later. The committee moves it through *Open → In repair → Waiting on parts → Fixed / Closed*, each status change recorded with an optional note, so every issue has a timeline of progress. Boat cards show how many issues are still open. The committee can edit or delete issues and delete photos.
  - **Photos are compressed on the phone**, not the server: before uploading, the browser resizes each photo to at most 1600 px and saves it as a JPEG (typically 200–500 KB). This also removes the photo's metadata, including its GPS position. The server never opens or decodes images. It writes the upload straight to disk and rejects anything over 2 MB or that isn't a JPEG, PNG or WebP. This keeps memory use flat.
  - **Storage limit**: photos may use 300 MB in total by default (**Settings → Data**, which also shows how much is used). Once it's full, new uploads are refused until photos are deleted or the limit is raised. Deleting an issue or a boat deletes its photo files too.
- **Weekly schedule**: the committee creates water outings (pick a boat, which sets the seats) and land sessions. Seats are filled with a searchable picker that shows each person's eligibility. The committee can copy the previous week (with or without crews, from **Sign-ups → Copy last week's schedule**) and keep a week as a draft until they **Publish** it to rowers.
- **Weekly sign-up** (replaces the Google Form): under **Sign-ups**, the committee lists the week's water, erg and tank sessions (or copy last week's), add an optional message, and open the form. Rowers give their name (picked from the list, or typed in full to add themselves as a new member flagged *New* for the committee to check), phone number, college (Reuben, Blackfriars, St Stephen's House or other), whether they're signing up as a rower, cox, both or bankrider/coach, how many rowing and coxing outings they want, their squad (Open or Women's, asked of rowers only and saved to their profile), side preference, the most outings they'll do that week, which sessions they're free for, and whether they can bankride. Sending the form again updates their answers. The committee sees the responses, a people × sessions availability grid and per-session counts (rowers counted per squad, Open and Women's, so it's clear whether there are enough for each crew; coxes are counted once, as they can cox either), and can export everything as CSV. **Create session** on a slot opens the outing editor already filled in, and the seat picker lists people who are free for that time first, with their side preference and how many outings they've been given out of their weekly maximum.
- **Crew picking**: the session editor shows a **Signed up** panel next to the seats, listing everyone who said they're free for that session, grouped as coxes, rowers and people who can bankride. Fewest outings this week come first, and you can see side preference and how many outings each person has been given out of their weekly maximum. Click a name to put them in the boat (coxes go to the cox seat, and rowers go to their side: stroke side is the even seats, bow side the odd ones). Click it again to take them out, or click a seat's name first to choose exactly where the next person goes. People who signed up for other sessions that week are listed underneath.
- **Auto-fill crews** (Sign-ups → *Auto-fill crews*, committee only, for the week shown there): proposes crews for the empty seats in the week's draft water outings from the weekly sign-up, and shows the proposal before anything is saved. People already placed stay put, and sessions stay drafts so the committee can adjust them before publishing (tick *Also fill published sessions* to include those). It only uses people who said they're free for that session and are eligible (subs, swim test, novice free outings, counting the outings it has just planned), within their weekly maximum, not booked at an overlapping time, and in at most one water outing a day. Coxes need a cox status. Bow-side-only and stroke-side-only rowers sit on their side, and side preferences are followed where possible. People furthest below the number of rowing or coxing outings they asked for go first, and someone only gets more than they asked for (up to their maximum) when a boat would otherwise be short. Novice crews get 2, ideally 3, seniors in an eight (fewer in smaller boats), and seniors with the fewest novice outings that week go first. Senior crews stay in one squad (Open or Women's) unless that would leave seats empty. The hardest sessions to fill are planned first, and complete crews before partial ones. Empty coach/bankrider fields get someone who can bankride and is free then (novice coxes first). A crew name like *Novice W*, *NM1* or *W1* tells it the crew's category and squad. Otherwise it goes by who's already in the boat, or by who signed up.
- **Times and places**:
  - Sessions and sign-up slots have a start and an optional end time, entered with time pickers and stored as 24-hour `HH:MM`, so they always sort correctly. Older free-text times such as "6:30" or "7am-8.30am" are converted automatically on start-up.
  - **Settings → Places** gives a place name (e.g. "Boathouse") a full address and, optionally, coordinates (or a pasted Google Maps link). Sessions at that place show a maps link.
  - Calendar events carry the address plus a GPS pin, so a phone can start navigation straight from the event.
- **Calendar subscription**: **Add to calendar** (on the schedule and on My outings) gives each person a private feed link for Apple Calendar, Google Calendar, Outlook or any app that can subscribe to a calendar. It contains every published outing they're in, plus sessions where they're named as coach or bankrider, with the start and end time, the place's full address (and GPS pin), boat, coach, crew list and notes. Without an end time, water outings default to 90 minutes and land sessions to 60. Calendar apps re-check the feed by themselves, so changes, subs and new sessions flow through. Outings with no recognisable time show as all-day events. A person can get a new link to stop an old one working. Google Calendar only refreshes subscribed calendars every few hours, and it needs the site to be reachable from the internet.
- **Subs reminders** (Rowers → *Subs reminders*, committee only): every active member who hasn't paid and needs a reminder, most urgent first. The order is: already scheduled in sessions they can't do, then must pay before their next outing (free novice outings used, or senior past the cutoff), then must pay by the cutoff, then 1 free novice outing left. Counts include outings already scheduled. Each person has **Copy message** (the reminder text, editable under **Edit message**, with placeholders `{first_name}`, `{reason}`, `{term}`, `{year}` and `{cutoff}`; `{reason}` becomes e.g. “By the end of this week you will have reached 4 water outings”), **Text** (opens your phone's messaging app with the message filled in), **Mark reminded** (Copy and Text do this automatically, so you don't chase people twice) and **Mark paid** (Single term or Full year for the current term). On the Members list, *May row next* uses the same counting, so it always matches what the schedule shows.
- **Phone numbers are protected**:
  - **Rowers can't see them:** no page or data request available to rowers ever includes them.
  - **Encrypted in the database:** encrypted with `PHONE_KEY`, so the database file, Unraid backups and "Download database backup" contain no readable numbers. Deleted or replaced values are overwritten with zeros, so old copies don't linger in the file.
  - **Masked for the committee:** committee screens show only the last 3 digits. The full number is fetched when a committee member taps **Show**.
  - **Left out of exports by default:** CSV exports include numbers only if the committee member ticks the box.
  - **Deleted automatically:** a number is removed once its owner hasn't signed up for a set number of days (default 180, in **Settings → Phone numbers**). The committee can also delete one by hand.
  - **Configurable:** the form can make the number required, optional, or not ask for it at all.
- **Open land sessions**: land sessions show how many spots are open, and any rower can tap **Join** to take one, or **Leave** to give theirs up. No sub is needed, because the spot simply reopens. Joining uses the normal eligibility rules (subs, already booked at that time) and stops when the session is full. The **Open spots** filter on the schedule lists land sessions with space. Water crews are still picked by the committee.
- **Subs**: a rower taps **Can't go** on their own seat to post a request to the **Sub board**. Another rower takes it with **I'll sub**, and the seat and the outing count move to them. People who aren't eligible (no swim test, unpaid after the cutoff, double-booked, not a cox for the cox seat) are blocked from taking a seat.
- **Races**: the committee adds races under **Races** with a title, date, term, city, expected time slot, who should enter (everyone, novices or seniors), which squad (any, Open or Women's), race type (free text, with earlier types suggested), notes, and any number of source links (web links only). Rowers answer **Available**, **Maybe** or **Not available**. Except for *Not available* (one tap), they also say whether they'd row, cox or both and, if they'd row, their squad (Open or Women's) and side preference (the same options as the weekly sign-up; coxes aren't asked either), plus an optional note that only the committee sees. Squad and side are saved to their profile (the committee can also set the squad on the member's page).
  - **Eligibility**: a novice race is for novices, a senior race for seniors, and an Open or Women's race needs a rower from that squad. Coxes can cox either squad, and senior coxes can also cox novice races (a senior who picks *Rower or cox* for a novice race is told they can only cox it). The form checks as you fill it in. Rowers can't send an ineligible response. The committee sees why someone isn't eligible as soon as they're picked, and can still **Save anyway**; those people are flagged *Not eligible* in the committee's view. Responses can only be changed while the race is open and hasn't happened yet.
  - **Who's available**: each race card shows how many Open rowers, Women's rowers and coxes are available (someone who'd row or cox is counted in both), plus how many said maybe or not available. Clicking any of these, or **See who**, opens the answers as crew columns (Open rowers, Women's rowers, Coxes) with each person's novice/senior status and side, switchable between Available, Maybe and Not available. The committee clicks a person there to change their answer, or adds someone.
- **Committee** (Committee → *Overview*): who holds each position (President, Vice-President, up to two Men's Captains and two Women's Captains, Treasurer, Captain of Coxes, Senior Member, Welfare Officer, Kit Officer), visible to everyone. The committee fills it in with **Edit committee**, picking a club member or typing a name for someone who isn't in the club list (e.g. a Senior Member who doesn't row). Members who hold a position get a golden **C** next to their name in the rowers list, with their position(s) on hover. Being listed doesn't grant committee access in the app: that still comes from the committee password.
- **Committee to-do** (Committee → *To-do*, committee only): the committee's to-do list. Each task has a priority, plan of action, who's doing it, an optional due date and a status (*To do*, *In progress*, *Waiting*, *Done*), plus a timeline of updates instead of a single "Completion/update" cell. Tasks can **repeat every year** (insurance, BR affiliation, EA registration, safety audit): marking one done adds next year's task with the same details. The tab's count shows open tasks that are high priority or due within two weeks. A task that's really about one boat can be **moved to boat issues**, keeping its plan and updates.
- **Committee handbook** (Committee → *Handbook*, committee only): free text for standing information to hand over each year, such as contacts, procedures and race reminders. Web addresses and emails become links.
- **Rowers database**: Novice/Senior category, swim test, subs plan, cox status (N/X/S), and water/land outing totals. Totals are worked out from the schedule plus a baseline of earlier outings, so there's no weekly roll-over to do. The committee can export members as CSV.
- **Coaches**: sessions per coach per month, matched by the coach's name appearing in the Coach/bankrider field.

### River rules and the OURCs flag (Isis)

The club boats from its own boathouse on the Isis, so water outings are checked against the [OURCs river restrictions](https://ourcs.co.uk/information/river-restrictions/) and the current [Isis flag](https://ourcs.co.uk/information/flags/isis/). The code is in `app/river.py`.

- **Flag**: fetched every hour from `https://ourcs.co.uk/api/flags/status/isis/` and stored in the database. If a fetch fails, the last known flag is kept and marked *may be out of date* after 3 hours. The schedule shows the flag and its notices to everyone, and **River rules** opens the full rules plus what each flag means. The committee can also use **Settings → River rules → Check flag now**. Set `RIVER_FLAG_FETCH=off` to turn fetching off.
- **Checks** (shown on each outing card and live in the session editor; they never block saving):
  - Daylight: not earlier than 1 hour before sunrise or later than 1 hour after sunset (calculated for Oxford). Each day on the schedule shows the allowed window.
  - Sundays 08:00–13:00 and Wednesdays after 19:00: no crews.
  - Peak term (Thursday of 0th week to the end of the major regatta): crews per club before 08:00 on weekdays (Trinity: two 4s/8s), and the Trinity 17:00–19:00 restriction.
  - Flag, for today and future outings: Red/Black means no crews. Amber requires a senior cox (status S), a senior crew (at least 4 Senior rowers and no novices) and a bankrider (the Coach/bankrider field). Dark Blue rules out novice or unregistered coxes. Light Blue rules out unregistered coxes, and novice coxes are only allowed under its conditions (sunrise to sunset, senior crew, bankrider, registered 2 hours ahead). Grey means the club must do its own risk assessment.
  - Rowers see only the problems that break a rule. The committee also sees the things to check.
- **Not checked**: the weekday 08:30–13:00 rule (Reuben is exempt), Godstow and St Edward's rafts, regatta-day restrictions, and term-based experience (the app only knows Novice/Senior).
- **Settings → River rules**: the start of Full Term (Sunday of 1st week), when the major regatta ends (blank = end of 8th week), and how many crews may be out at once before 08:00 (2 with an Extra Slot).

### Rules (taken from the spreadsheet)

- Subs are valid for a *Full year* plan that matches the current academic year, or a *Single term* plan that matches the current term and year. Anyone can row up to and including the **subs cutoff date**.
- **Swim test**: nobody needs one for their first 4 water outings (setting: *Swim test required after*). From the 5th water outing on, it's required. Land sessions never need one.
- A **novice who hasn't paid subs** gets N free water outings (default 4) that need no subs. Once their subs are paid, the allowance no longer applies. Cox seats count as water outings. While a novice still has free outings left, land training is free too (this can be switched off).
- Eligibility is checked for each session using that session's date and the person's running water count up to it.
- A novice cox (status N) with no coach/bankrider set gets flagged **Bankrider needed**.

## Notes

- **Menu**: seven main pages (Schedule, Sign up, Races, My outings, Rowers, Boat park, Committee), the same for rowers and the committee. Related pages are tabs under them: *Week / Sub board*, *My outings / Leaderboard*, *Members / Subs reminders* (the second for the committee), *Boats / Issues / Usage* and *Overview / To-do / Handbook / Coaches* (all but Overview for the committee). The committee opens **Settings** from the gear icon next to their name (on phones, at the bottom of the menu). Old links such as `#/subs` or `#/stats` still work.
- The shared passwords decide whether someone is on the committee or a rower. Rowers pick their own name ("Who are you?"), and the app remembers it on that device. There are no individual accounts, so a rower could pick someone else's name. That's normal for a shared-password club tool.
- Rowers never see payment or swim-test status. Only the committee does.
- Back up the database from **Settings → Data**, or copy the volume.

## Local development

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
COMMITTEE_PASSWORD=committee123 MEMBER_PASSWORD=rower123 DATA_DIR=./data .venv/bin/uvicorn app.main:app --reload
```
