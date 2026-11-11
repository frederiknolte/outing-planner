# Outing planner: working notes

A FastAPI + SQLite backend (`app/*.py`) and a single-file vanilla JS frontend (`app/static/app.js`, `app.css`, `index.html`). The committee builds each week's sessions; rowers see the published schedule, ask for subs and take open seats.

The aim of these notes is that **every edit leaves the code as tidy as a dedicated clean-up pass would**. Before writing new code, find what already exists. A change is finished only when nothing in it duplicates something that exists elsewhere, and nothing it made obsolete is left behind.

## Where things live

| Module | Holds |
|---|---|
| `main.py` | Start-up, app and middleware, the list of routers, static files. **Don't add endpoints here.** |
| `auth.py` | Passwords, login/logout/me, `require_member` / `require_committee`, `hash_pw`, `is_committee_password` |
| `common.py` | Helpers shared by the routers: reading request values, `today(conn)`, rules about what rowers may see, sub-request status changes (see the table below) |
| `logic.py` | Domain logic with no FastAPI: `Rules` (eligibility, totals, expiries), seat and boat helpers, `outing_payload`, `to_date`, `int_setting`, `places_by_name`, `season_start`, `effective_today` |
| `schedule.py` | `/api/bootstrap`, `/api/week`, `/api/month`, `outings_payload()` (full outing payloads in a single pass) |
| `outings.py` | Committee outing create/edit/cancel/delete, week publish and copy, seat-picker candidates, river check and settings, weather |
| `subs.py` | Sub board, sub candidates, request/fill/cancel, joining and leaving land sessions |
| `members.py` | Profiles, `/api/rowers`, the committee members list and editing, subs reminders, phone numbers, the members CSV, coaches |
| `boats.py`, `places.py`, `settings.py` | What their names say (`settings.py` also has the backup) |
| `signup.py`, `races.py`, `socials.py`, `crewlog.py`, `push.py`, `calendar.py`, `stats.py`, `usage.py`, `issues.py`, `incidents.py`, `tasks.py`, `handover.py`, `autofill.py`, `committee_roster.py` | One feature each; each module's docstring explains the feature |
| `db.py` / `migrations.py` | `SCHEMA` for new databases; `MIGRATIONS` adds columns to existing ones (add a new column to **both**) |
| `timeutil.py`, `terms.py`, `river.py`, `privacy.py`, `weather.py`, `presence.py` | Times of day, Oxford terms and academic years, river rules and flag, phone encryption, forecasts, who's online |

A new feature gets its own module with a `router = APIRouter()`, added to the router tuple in `main.py`. Each module starts with a docstring that explains the feature and its rules.

## Reuse these, never re-implement them

**Backend (`common.py` unless stated)**

| Need | Use |
|---|---|
| A required date from a request (400 on error) | `parse_date(text, "message")` |
| An optional date ('' or YYYY-MM-DD) | `optional_date(text, "message")` |
| A stored or optional date, where an invalid one should just count as unset | `logic.to_date(text)` returns `None` |
| Monday of the week a request names | `monday_param(text)` |
| Start and end times from free text | `parse_times(start, end, example)` |
| "Today" for the club (honours `today_override`) | `today(conn)`, or `rules.today` when you already have `Rules` |
| Rowers must only see published rows | `published_only(committee, column)` in the SQL, or `visible_outing(conn, oid, role, what, upcoming=…)` for one outing; `require_upcoming(conn, o, what)` for "in the past" or "cancelled" |
| A name that has to be unique | `with db.get_conn() as conn, unique_name("boat"):` |
| Close, fill or cancel sub requests | `resolve_sub`, `cancel_open_subs`, `settle_open_subs`. Never write `UPDATE sub_requests SET status…` inline |
| Someone already seated at the same time | `busy_at(conn, o, exclude_id)` |
| Can this member take this seat? | `subs.candidates(...)`, then `problems_error("Can't X", status)` |
| Boats keyed by id, places keyed by lower-case name | `boats_by_id(conn)`, `logic.places_by_name(conn)` (or `rules.places`) |
| Number settings | `logic.int_setting(settings, key, default)`; `settings.NUMBER_SETTINGS` lists the ones the page edits |
| Season start | `logic.season_start(settings, today)` |
| Members in name order, or only rowers | `rules.sorted_members(active_only=...)` |
| A rower's status and qualifications | `rules.status_fields(m)` |
| Logging crew changes, sending push notifications | `crewlog.state` before the change → `crewlog.record` after it; `push.snapshot` → `push.crew_changes` → `push.dispatch` **after** the `with` block |

**Frontend (top of `app.js`)**: `api`, `apiDo(path, opts, okMsg)` (use it for every call whose error should just be a toast), `modal`, `confirmBox`, `combo`, `nameSuggest`, `pills`, `toast`/`fail`, `esc` (escape **every** value put into HTML), `isCommittee()`, `requireMe`, chips (`catChip`, `squadChip`, `sideChip`, `expiryChip`), dates (`pd`, `iso`, `addDays`, `fmtShort`, `fmtLong`, `fmtYear`), `tRange`, `oTitle`, seat helpers, `loadPlaces`/`placesDatalist`, `rerender`.

## Rules for every edit

1. **Search before writing.** Before adding a check, query, helper, constant or UI snippet, grep for it: the error message, the SQL fragment, the shape of the logic. If it exists, use it. If you're about to write a second copy of anything that isn't trivial, turn the first copy into a helper in the same change and use it in both places.
2. **Put a helper where its callers can share it.** One module only: a private `_name` in that module. Several routers, and it touches HTTP (raises `HTTPException`): `common.py`. Pure domain logic: `logic.py` (no FastAPI imports there). To avoid circular imports, `common` and `logic` must never import feature modules.
3. **Validate through the helpers** and keep each module's wording for its errors (pass the message in). Validate before opening the connection where possible. Python-side constants that list valid values (`SIDES`, `SQUADS`, `TERMS`, `SUBS_PLANS`, `BOAT_TYPES`, `CANCEL_REASONS`, `CLUB_CREWS`) live in one place; import them, never retype them.
4. **INSERT and UPDATE share one field list.** Build the values with one `_fields(b)` function (and one column tuple when the list is long) instead of listing the columns twice.
5. **Load data once per request.** Build `Rules(conn)` once and pass it down. Don't build it when you only need settings or today (`db.get_settings`, `today(conn)`). Load related rows in bulk (`IN (...)` plus a dict), never with one query per row. Do slow network calls outside `db.get_conn()`.
6. **Remove what your change makes obsolete**: helpers, imports, branches, CSS classes, endpoints the page no longer calls. Run `python -m pyflakes app/*.py`. The only warning allowed is the `TERMS` re-export in `logic.py`.
7. **Stay at the level of the surrounding code.** No speculative parameters, options or layers. A small focused function beats a general one with flags. Comments explain *why*, not what.
8. **Frontend changes**: bump `?v=` for `app.js` / `app.css` in `index.html` on every change to them, or browsers keep the old file. Use `apiDo` instead of hand-written `try { await api(...) } catch (e) { fail(e) }`, unless the catch does more than `fail(e)`. Get what the server already knows from the server (eligibility, labels, counts) instead of recomputing it in JS.
9. **Schema changes**: add the column to `db.SCHEMA` and to `migrations.MIGRATIONS`. One-off data changes go in a step in `migrations.run()` that does nothing once it has been applied.

## Domain rules that apply everywhere

- **Say "committee", never "admin"**, in code, UI text and messages. Committee members are rowers too: anything a rower can do, they can do. Committee-only extras are added on top, never instead.
- **Coaches** are members with category `Coach` and are always stored with `active = 0`, which keeps them out of the rower logic. Rower-side code just checks `active`. Don't add `category != 'Coach'` checks or a separate rowers view. Anything that creates or edits members must keep Coach → inactive.
- **Drafts**: outings, socials and race crews are hidden from rowers until published. A committee member previewing as a rower (`X-View-As: member`) gets the role `"member"` from `require_member`, so always compare `role == "committee"`; never read the session yourself.
- **Cancelled outings** stay on the schedule, but don't count for totals, free outings, stats, double-booking or boat usage (`cancelled = 0` in those queries).
- **Phone numbers** are committee-only and stored encrypted (`privacy`). No endpoint a rower can call may return one; return `has_phone` / `phone_masked` instead.
- **Dates** are stored as `YYYY-MM-DD` text and times as `HH:MM`, so plain string comparison sorts correctly. Compare against `today(conn).isoformat()`, never against `date.today()`.
- **Text people see** is plain British English: short and specific, and it tells the user what to do ("Pick a date for the race", not "Invalid input").

## Checking a change

There's no test suite. For backend changes, exercise the endpoints with FastAPI's `TestClient` against a temporary database. Set the environment variables before importing the app:

```python
import os, tempfile
os.environ.update(DATA_DIR=tempfile.mkdtemp(), COMMITTEE_PASSWORD="c-pw-1", MEMBER_PASSWORD="m-pw-1",
                  RIVER_FLAG_FETCH="off", SECRET_KEY="x" * 40)
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app); c.post("/api/login", json={"password": "c-pw-1"})
```

Use `.venv/bin/python`. `httpx` isn't in the venv, so install it into a scratch folder and put that on `PYTHONPATH`. For a refactor, record the responses from before the change and compare them with the responses after it. Check JS with `node --check app/static/app.js`. Run the app with `docker compose up -d --build` (see the README).
