"""SQLite storage."""
import os
import sqlite3
from contextlib import contextmanager

from . import migrations

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
DB_PATH = os.path.join(DATA_DIR, "outings.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS boats (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    boat_type TEXT NOT NULL DEFAULT '8+',
    seats INTEGER NOT NULL DEFAULT 8,
    coxed INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'available',      -- available | repair | retired
    rigging TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category TEXT NOT NULL DEFAULT 'Novice',       -- Novice | Senior | Coach
    swim_test INTEGER NOT NULL DEFAULT 0,
    subs_plan TEXT NOT NULL DEFAULT 'Unpaid',      -- Unpaid | Single term | Full year
    subs_term TEXT NOT NULL DEFAULT '',
    subs_year TEXT NOT NULL DEFAULT '',
    cox_status TEXT NOT NULL DEFAULT '',           -- '' | N | X | S
    past_water INTEGER NOT NULL DEFAULT 0,         -- outings before this system (baseline)
    past_land INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS outings (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                            -- water | land
    date TEXT NOT NULL,                            -- YYYY-MM-DD
    time TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    coach TEXT NOT NULL DEFAULT '',
    boat_id INTEGER REFERENCES boats(id) ON DELETE SET NULL,
    capacity INTEGER NOT NULL DEFAULT 8,
    coxed INTEGER NOT NULL DEFAULT 1,
    published INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_outings_date ON outings(date);

-- Socials and sports activities: club events shown on the schedule and in calendar feeds (see socials.py).
CREATE TABLE IF NOT EXISTS socials (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,                            -- YYYY-MM-DD
    time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'social'            -- social | sport (a sports activity such as a run; only in the calendars of those who signed up)
);
CREATE INDEX IF NOT EXISTS idx_socials_date ON socials(date);

-- Who has signed up to a social or sports activity. Plain list: no seats or limit.
CREATE TABLE IF NOT EXISTS social_signups (
    social_id INTEGER NOT NULL REFERENCES socials(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (social_id, member_id)
);

CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY,
    outing_id INTEGER NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
    seat INTEGER NOT NULL,                         -- 0 = cox, 1 = bow ... n = stroke (land: 1..n)
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    UNIQUE(outing_id, seat),
    UNIQUE(outing_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_member ON assignments(member_id);   -- "my outings", calendar feed

CREATE TABLE IF NOT EXISTS sub_requests (
    id INTEGER PRIMARY KEY,
    outing_id INTEGER NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
    seat INTEGER NOT NULL,
    requester_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',           -- open | filled | cancelled
    sub_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);
DROP INDEX IF EXISTS idx_subs_status;                     -- replaced: lookups are always per outing
CREATE INDEX IF NOT EXISTS idx_subs_outing ON sub_requests(outing_id, status);

-- Change log for published crews and sub requests (see crewlog.py). Rowers only pick a name, so this
-- records who did what and when, and lets the committee undo a bad edit.
CREATE TABLE IF NOT EXISTS crew_log (
    id INTEGER PRIMARY KEY,
    outing_id INTEGER NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
    action TEXT NOT NULL,                          -- join | leave | replace | move | swap | sub_request | sub_cancel
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,   -- whose seat changed
    member_name TEXT NOT NULL DEFAULT '',
    other_id INTEGER REFERENCES members(id) ON DELETE SET NULL,    -- replace: who left; swap: the other rower
    other_name TEXT NOT NULL DEFAULT '',
    seat INTEGER,                                  -- the seat now (leave: the seat given up)
    from_seat INTEGER,                             -- move / swap: the seat before
    sub_request_id INTEGER,
    note TEXT NOT NULL DEFAULT '',                 -- e.g. the reason given for a sub request
    source TEXT NOT NULL DEFAULT '',               -- join | leave | sub_fill | sub_handover | sub_request | committee | autofill | undo
    by_id INTEGER REFERENCES members(id) ON DELETE SET NULL,       -- the name picked on the device that made the change
    by_name TEXT NOT NULL DEFAULT '',
    by_role TEXT NOT NULL DEFAULT '',              -- member | committee
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    undone_at TEXT,
    undone_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_crew_log_outing ON crew_log(outing_id);

-- Weekly availability sign-up (replaces the old Google Form)
CREATE TABLE IF NOT EXISTS signup_weeks (
    week_start TEXT PRIMARY KEY,                   -- Monday, YYYY-MM-DD
    open INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS signup_slots (
    id INTEGER PRIMARY KEY,
    week_start TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'water',            -- water | erg | tank
    location TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_slots_week ON signup_slots(week_start);

CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY,
    week_start TEXT NOT NULL,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'rower',            -- rower | cox | both | bankrider
    want_row INTEGER NOT NULL DEFAULT 0,           -- most rowing (water) outings they want
    want_cox INTEGER NOT NULL DEFAULT 0,           -- coxing outings wanted
    side TEXT NOT NULL DEFAULT '',
    max_land INTEGER NOT NULL DEFAULT 0,           -- most land (erg / tank) sessions they want
    can_bankride INTEGER NOT NULL DEFAULT 0,
    college TEXT NOT NULL DEFAULT '',
    comments TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(week_start, member_id)
);

-- Named places with a real address, for maps links and calendar navigation
CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    address TEXT NOT NULL DEFAULT '',
    lat REAL,
    lon REAL
);

-- Committee to-do list (see tasks.py)
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT '',             -- high | medium | low | ''
    plan TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',                -- free text, e.g. "Sophie to chase Toby", "Captains"
    due TEXT NOT NULL DEFAULT '',                  -- YYYY-MM-DD or ''
    repeat TEXT NOT NULL DEFAULT '',               -- '' | term | year (comes back when done, see tasks.py)
    status TEXT NOT NULL DEFAULT 'open',           -- open | in_progress | waiting | done
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_at TEXT
);

CREATE TABLE IF NOT EXISTS task_updates (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT '',               -- new status, or '' for a plain update
    note TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_updates ON task_updates(task_id);

-- Club committee positions (see committee_roster.py)
CREATE TABLE IF NOT EXISTS committee_holders (
    position TEXT NOT NULL,                        -- president | vice_president | mens_captain | ...
    slot INTEGER NOT NULL DEFAULT 0,               -- 0, or 1 for the second captain
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',                 -- used when the holder isn't a club member
    PRIMARY KEY (position, slot)
);

-- Boat issue tracker
CREATE TABLE IF NOT EXISTS boat_issues (
    id INTEGER PRIMARY KEY,
    boat_id INTEGER NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'minor',        -- minor | caution | unusable
    status TEXT NOT NULL DEFAULT 'open',           -- open | in_progress | waiting | fixed | closed
    reported_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_boat ON boat_issues(boat_id);

CREATE TABLE IF NOT EXISTS issue_updates (            -- timeline: status changes and notes
    id INTEGER PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES boat_issues(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT '',               -- new status, or '' for a plain note
    note TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_issue_updates ON issue_updates(issue_id);

CREATE TABLE IF NOT EXISTS issue_photos (             -- files live in DATA_DIR/photos
    id INTEGER PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES boat_issues(id) ON DELETE CASCADE,
    filename TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL DEFAULT 0,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Incident and capsize log (see incidents.py). Anyone can report; only the committee can read it.
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,                            -- YYYY-MM-DD
    time TEXT NOT NULL DEFAULT '',                 -- HH:MM or ''
    kind TEXT NOT NULL DEFAULT 'capsize',          -- capsize | collision | injury | near_miss | equipment | other
    outing_id INTEGER REFERENCES outings(id) ON DELETE SET NULL,
    boat_id INTEGER REFERENCES boats(id) ON DELETE SET NULL,
    boat_name TEXT NOT NULL DEFAULT '',            -- kept if the boat is later deleted
    crew TEXT NOT NULL DEFAULT '',                 -- names as written at the time (free text)
    location TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',          -- what happened
    injury TEXT NOT NULL DEFAULT 'none',           -- none | first_aid | medical | hospital
    injury_details TEXT NOT NULL DEFAULT '',
    action_taken TEXT NOT NULL DEFAULT '',         -- what was done at the time
    follow_up TEXT NOT NULL DEFAULT '',            -- committee: lessons, changes made afterwards
    status TEXT NOT NULL DEFAULT 'open',           -- open (follow-up needed) | closed
    br_reported INTEGER NOT NULL DEFAULT 0,        -- reported to British Rowing
    br_reference TEXT NOT NULL DEFAULT '',
    br_reported_on TEXT NOT NULL DEFAULT '',       -- YYYY-MM-DD or ''
    issue_id INTEGER REFERENCES boat_issues(id) ON DELETE SET NULL,   -- boat issue for damaged equipment
    reported_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incidents_date ON incidents(date);
CREATE INDEX IF NOT EXISTS idx_incidents_issue ON incidents(issue_id);

-- Races: the committee lists them, members say whether they're available
CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,                            -- YYYY-MM-DD
    term TEXT NOT NULL DEFAULT '',                 -- Michaelmas | Hilary | Trinity
    city TEXT NOT NULL DEFAULT '',
    time_slot TEXT NOT NULL DEFAULT '',            -- free text, e.g. "Morning" or "09:00-13:00"
    entry TEXT NOT NULL DEFAULT 'all',             -- all | novice | senior
    race_type TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    open INTEGER NOT NULL DEFAULT 1,               -- members can respond
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(date);

CREATE TABLE IF NOT EXISTS race_links (
    id INTEGER PRIMARY KEY,
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    label TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS race_responses (
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status TEXT NOT NULL,                          -- yes | maybe | cox (cox only) | no
    comment TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (race_id, member_id)
);

-- Race crews: the committee forms crews from the race responses (draft until races.crews_published)
CREATE TABLE IF NOT EXISTS race_crews (
    id INTEGER PRIMARY KEY,
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',                 -- e.g. "W1", "Novice M"
    boat_type TEXT NOT NULL DEFAULT '8+',          -- one of logic.BOAT_TYPES
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_race_crews_race ON race_crews(race_id);

CREATE TABLE IF NOT EXISTS race_crew_seats (
    crew_id INTEGER NOT NULL REFERENCES race_crews(id) ON DELETE CASCADE,
    seat INTEGER NOT NULL,                         -- 0 = cox, 1 = bow ... n = stroke
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    PRIMARY KEY (crew_id, seat)
);
CREATE INDEX IF NOT EXISTS idx_race_crew_seats_member ON race_crew_seats(member_id);

CREATE TABLE IF NOT EXISTS race_crew_reserves (
    crew_id INTEGER NOT NULL REFERENCES race_crews(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (crew_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_race_crew_reserves_member ON race_crew_reserves(member_id);

-- Year-end handover: a snapshot of each finished season (see handover.py)
CREATE TABLE IF NOT EXISTS season_archives (
    id INTEGER PRIMARY KEY,
    academic_year TEXT NOT NULL UNIQUE,            -- the year that was handed over, e.g. 2026-27
    season_start TEXT NOT NULL DEFAULT '',
    season_end TEXT NOT NULL DEFAULT '',           -- last day counted
    data TEXT NOT NULL DEFAULT '{}',               -- JSON: leaderboard, boat usage, roster, handbook, subs, promotions
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (           -- one row per device with notifications on (push.py)
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_member ON push_subscriptions(member_id);

CREATE TABLE IF NOT EXISTS push_sent (                    -- one-off alerts already sent (e.g. red flag per outing)
    key TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signup_availability (
    signup_id INTEGER NOT NULL REFERENCES signups(id) ON DELETE CASCADE,
    slot_id INTEGER NOT NULL REFERENCES signup_slots(id) ON DELETE CASCADE,
    PRIMARY KEY (signup_id, slot_id)
);
"""

DEFAULT_SETTINGS = {
    "club_name": "Reuben Boat Club",
    "academic_year": "2026-27",
    "current_term": "Michaelmas",
    "subs_cutoff": "",
    "today_override": "",
    "novice_free_outings": "4",
    "novice_land_free": "1",
    "season_start": "2026-10-01",
    "member_password_hash": "",
    "swim_test_after": "4",
    "swim_test_valid_months": "12",     # 0 = never expires
    "cox_status_valid_months": "12",    # 0 = never expires
    "capsize_drill_valid_months": "12", # 0 = never expires
    # Subs reminder text. Placeholders: {first_name} {reason} {term} {year} {cutoff}
    "subs_reminder_template": 'Hi {first_name}, I’m Frederik, the treasurer of Reuben Boat Club! {reason} and for continuing to row with RBC, you’ll need to become a member and pay subs. With the subs we fund new equipment, socials, and insurance, so it’s really important that all members pay them🙏 You can pay either for a termly or a yearly membership here: https://www.oxforduniversitystores.co.uk/product-catalogue/reuben-college/boat-club',            # water outings allowed before a swim test is required
    "phone_mode": "required",          # sign-up form: required | optional | off
    "phone_retention_days": "180",     # delete numbers after this long without a sign-up (0 = keep)
    # River rules (see river.py)
    "term_start": "2026-10-11",        # Sunday of 1st week of Full Term
    "peak_end": "",                    # last day of the term's major regatta; blank = end of 8th week
    "peak_crews_before_8": "1",        # crews allowed on the water at once before 08:00 in peak term (Extra Slot = 2)
    "photo_storage_mb": "300",         # total space boat-issue photos may use
    "service_interval_hours": "",      # boat usage: flag a boat for servicing after this many hours (blank = off)
}


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # Overwrite deleted/replaced data with zeros, so e.g. old phone numbers don't linger in the file.
    conn.execute("PRAGMA secure_delete = ON")
    return conn


@contextmanager
def get_conn():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        migrations.run(conn)
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v))
        conn.execute("UPDATE settings SET value = ? WHERE key = 'club_name' AND value IN ('Boat Club', 'Reuben College Boat Club')",
                     (DEFAULT_SETTINGS["club_name"],))
        conn.commit()
    finally:
        conn.close()


def get_settings(conn) -> dict:
    s = dict(DEFAULT_SETTINGS)
    s.update({r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")})
    return s


def set_setting(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
