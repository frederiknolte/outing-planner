"""SQLite storage."""
import os
import sqlite3
from contextlib import contextmanager

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
    category TEXT NOT NULL DEFAULT 'Novice',       -- Novice | Senior
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

CREATE TABLE IF NOT EXISTS coaches (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    search_text TEXT NOT NULL DEFAULT ''           -- no longer used (coaches match on name only)
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

CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY,
    outing_id INTEGER NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
    seat INTEGER NOT NULL,                         -- 0 = cox, 1 = bow ... n = stroke (land: 1..n)
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    UNIQUE(outing_id, seat),
    UNIQUE(outing_id, member_id)
);

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
CREATE INDEX IF NOT EXISTS idx_subs_status ON sub_requests(status);

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
    want_row INTEGER NOT NULL DEFAULT 0,
    want_cox INTEGER NOT NULL DEFAULT 0,
    side TEXT NOT NULL DEFAULT '',
    max_outings INTEGER NOT NULL DEFAULT 0,
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
    repeat_yearly INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS signup_availability (
    signup_id INTEGER NOT NULL REFERENCES signups(id) ON DELETE CASCADE,
    slot_id INTEGER NOT NULL REFERENCES signup_slots(id) ON DELETE CASCADE,
    PRIMARY KEY (signup_id, slot_id)
);
"""

# Columns added after the first release; added to existing databases on start-up.
MIGRATIONS = {
    "outings": {
        "end_time": "TEXT NOT NULL DEFAULT ''",
        "cancelled": "INTEGER NOT NULL DEFAULT 0",     # kept on the schedule but doesn't count
        "cancel_reason": "TEXT NOT NULL DEFAULT ''",
    },
    "races": {"squad": "TEXT NOT NULL DEFAULT 'any'"},             # any | open | women
    "race_responses": {
        "squad": "TEXT NOT NULL DEFAULT ''",                        # open | women
        "role": "TEXT NOT NULL DEFAULT ''",                         # rower | cox | both
        "side": "TEXT NOT NULL DEFAULT ''",                         # same options as the weekly sign-up
    },
    "signup_slots": {"end_time": "TEXT NOT NULL DEFAULT ''"},
    "signups": {"squad": "TEXT NOT NULL DEFAULT ''"},              # open | women (rowers only)
    "members": {
        "phone": "TEXT NOT NULL DEFAULT ''",          # committee-only
        "college": "TEXT NOT NULL DEFAULT ''",
        "side": "TEXT NOT NULL DEFAULT ''",
        "squad": "TEXT NOT NULL DEFAULT ''",          # open | women (for race eligibility)
        "needs_review": "INTEGER NOT NULL DEFAULT 0",  # created via the sign-up form
        "cal_token": "TEXT NOT NULL DEFAULT ''",       # secret for the personal calendar feed
        "phone_updated_at": "TEXT NOT NULL DEFAULT ''",  # for automatic deletion of old numbers
        "subs_reminded_at": "TEXT NOT NULL DEFAULT ''",  # when the committee last reminded them to pay subs
    },
}

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
    # Subs reminder text. Placeholders: {first_name} {reason} {term} {year} {cutoff}
    "subs_reminder_template": 'Hi {first_name}, I’m Frederik, the treasurer of Reuben Boat Club! {reason} and for continuing to row with RBC, you’ll need to become a member and pay subs. With the subs we fund new equipment, socials, and insurance, so it’s really important that all members pay them🙏 You can pay either for a termly or a yearly membership here: https://www.oxforduniversitystores.co.uk/product-catalogue/reuben-college/boat-club',            # water outings allowed before a swim test is required
    "phone_mode": "required",          # sign-up form: required | optional | off
    "phone_retention_days": "180",     # delete numbers after this long without a sign-up (0 = keep)
    # River rules (see river.py)
    "term_start": "2026-10-11",        # Sunday of 1st week of Full Term
    "peak_end": "",                    # last day of the term's major regatta; blank = end of 8th week
    "peak_crews_before_8": "1",        # crews allowed on the water at once before 08:00 in peak term (Extra Slot = 2)
    "photo_storage_mb": "300",         # total space boat-issue photos may use
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
        for table, cols in MIGRATIONS.items():
            have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
            for col, decl in cols.items():
                if col not in have:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
        _normalize_times(conn)
        # Races used to have a separate "Cox only" answer; it's now Available + the cox role.
        conn.execute("UPDATE race_responses SET status = 'yes', role = 'cox', squad = '', side = '' WHERE status = 'cox'")
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v))
        conn.execute("UPDATE settings SET value = ? WHERE key = 'club_name' AND value IN ('Boat Club', 'Reuben College Boat Club')",
                     (DEFAULT_SETTINGS["club_name"],))
        conn.commit()
    finally:
        conn.close()


def _normalize_times(conn) -> None:
    """Store times as zero-padded 24h "HH:MM" (so they sort correctly); split "6:30-8pm" into start/end."""
    from .timeutil import normalize
    for table in ("outings", "signup_slots"):
        for r in conn.execute(f"SELECT id, time, end_time FROM {table}").fetchall():
            start, end = normalize(r["time"])
            end = normalize(r["end_time"])[0] if r["end_time"] else end
            if (start, end) != (r["time"], r["end_time"]):
                conn.execute(f"UPDATE {table} SET time = ?, end_time = ? WHERE id = ?", (start, end, r["id"]))


def get_settings(conn) -> dict:
    s = dict(DEFAULT_SETTINGS)
    s.update({r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")})
    return s


def set_setting(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
