"""One-off upgrades for databases created by earlier versions of the app.

db.SCHEMA is the current schema for new databases; everything here brings an older database up to
it, and run() is called from db.init_db() on every start-up. Each step is a no-op once applied, so
a step can be deleted after every deployed database has run it. Order matters: columns are added
first, old data is carried over, and only then are removed columns dropped.
"""

# Columns added after the first release; added to existing databases on start-up.
MIGRATIONS = {
    "outings": {
        "end_time": "TEXT NOT NULL DEFAULT ''",
        "cancelled": "INTEGER NOT NULL DEFAULT 0",     # kept on the schedule but doesn't count
        "cancel_reason": "TEXT NOT NULL DEFAULT ''",   # free-text note shown with the cancellation
        "cancel_category": "TEXT NOT NULL DEFAULT ''", # flag | weather | bankrider | numbers | other (see logic.CANCEL_REASONS)
    },
    "socials": {"kind": "TEXT NOT NULL DEFAULT 'social'"},        # social | sport (see socials.py)
    "boats": {"last_serviced": "TEXT NOT NULL DEFAULT ''"},       # YYYY-MM-DD or '' (see usage.py)
    "race_crews": {
        "bankrider": "TEXT NOT NULL DEFAULT ''",                    # free text like outings.coach: a member, a coach or anyone else
        "result": "TEXT NOT NULL DEFAULT ''",                       # free text outcome, e.g. "1st in Div 2" or "Won"
        "result_time": "TEXT NOT NULL DEFAULT ''",                  # free text time, e.g. "6:12.4"
        "result_notes": "TEXT NOT NULL DEFAULT ''",
    },
    "races": {
        "squad": "TEXT NOT NULL DEFAULT 'any'",                     # any | open | women
        "opens_at": "TEXT NOT NULL DEFAULT ''",                     # when entries open, local "YYYY-MM-DDTHH:MM" or ''
        "closes_at": "TEXT NOT NULL DEFAULT ''",                    # when entries close, same format
        "scratch_date": "TEXT NOT NULL DEFAULT ''",                 # scratch (withdraw) deadline, YYYY-MM-DD[THH:MM] or ''
        "crews_published": "INTEGER NOT NULL DEFAULT 0",            # rowers can see the race's crews
        "time": "TEXT NOT NULL DEFAULT ''",                         # start, HH:MM (replaces the free-text time_slot)
        "end_time": "TEXT NOT NULL DEFAULT ''",
    },
    "race_responses": {
        "squad": "TEXT NOT NULL DEFAULT ''",                        # open | women
        "role": "TEXT NOT NULL DEFAULT ''",                         # rower | cox | both
        "side": "TEXT NOT NULL DEFAULT ''",                         # same options as the weekly sign-up
    },
    "signup_slots": {"end_time": "TEXT NOT NULL DEFAULT ''"},
    "signups": {"squad": "TEXT NOT NULL DEFAULT ''"},              # open | women (rowers only)
    "tasks": {"repeat": "TEXT NOT NULL DEFAULT ''"},               # replaces repeat_yearly (see _migrate_task_repeat)
    "members": {
        "swim_test_date": "TEXT NOT NULL DEFAULT ''",               # YYYY-MM-DD the swim test was passed, or '' (unknown)
        "cox_status_date": "TEXT NOT NULL DEFAULT ''",              # YYYY-MM-DD the cox status was awarded, or ''
        "capsize_drilled": "INTEGER NOT NULL DEFAULT 0",            # has done a capsize drill (needed for boats of 2 or fewer)
        "capsize_drill_date": "TEXT NOT NULL DEFAULT ''",           # YYYY-MM-DD of the drill, or '' (unknown)
        "capsize_drill_expiry": "TEXT NOT NULL DEFAULT ''",         # unused: expiry is now the global capsize_drill_valid_months setting
        "phone": "TEXT NOT NULL DEFAULT ''",          # committee-only
        "college": "TEXT NOT NULL DEFAULT ''",
        "side": "TEXT NOT NULL DEFAULT ''",
        "squad": "TEXT NOT NULL DEFAULT ''",          # open | women (for race eligibility)
        "club_crew": "TEXT NOT NULL DEFAULT ''",      # comma-separated M1,M2,W1,W2 e.g. "M1,M2" (committee-only: never sent to non-committee clients)
        "needs_review": "INTEGER NOT NULL DEFAULT 0",  # created via the sign-up form
        "cal_token": "TEXT NOT NULL DEFAULT ''",       # secret for the personal calendar feed
        "phone_updated_at": "TEXT NOT NULL DEFAULT ''",  # for automatic deletion of old numbers
        "subs_reminded_at": "TEXT NOT NULL DEFAULT ''",  # when the committee last reminded them to pay subs
    },
}

# Columns that were removed again; dropped from existing databases on start-up.
DROPPED_COLUMNS = [
    ("outings", "happened"),   # the "Happened" confirmation was removed: past + not cancelled = went ahead
    ("tasks", "repeat_yearly"),  # now tasks.repeat = 'year' (to-dos can also repeat every term)
    ("members", "is_coach"),   # coach is now a category (Novice / Senior / Coach), migrated by _migrate_coach_tag
    ("races", "time_slot"),    # now races.time / end_time, migrated by _migrate_race_times
]


def _migrate_task_repeat(conn) -> None:
    """Yearly to-dos used to be a repeat_yearly flag; carry it over before the column is dropped."""
    if "repeat_yearly" in {r[1] for r in conn.execute("PRAGMA table_info(tasks)")}:
        conn.execute("UPDATE tasks SET repeat = 'year' WHERE repeat_yearly = 1 AND repeat = ''")


def _migrate_coaches_table(conn) -> None:
    """Coaches used to be their own table; they're now members with category Coach. Carry the old rows over
    (matching a member by name, else adding them as an inactive Coach so they aren't counted as squad)."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'coaches'").fetchone():
        return
    for c in conn.execute("SELECT name FROM coaches").fetchall():
        name = c["name"].strip()
        if conn.execute("UPDATE members SET category = 'Coach' WHERE name = ?", (name,)).rowcount == 0:
            conn.execute("INSERT INTO members(name, category, active) VALUES (?, 'Coach', 0)", (name,))
    conn.execute("DROP TABLE coaches")


def _migrate_coach_tag(conn) -> None:
    """Coach was briefly a tag (members.is_coach) on top of Novice / Senior; it's now a category of its own."""
    if "is_coach" in {r[1] for r in conn.execute("PRAGMA table_info(members)")}:
        conn.execute("UPDATE members SET category = 'Coach' WHERE is_coach = 1")


def _migrate_race_times(conn) -> None:
    """Races used to have a free-text time slot ("09:00-13:00", "Morning"). Read a clock time into
    time / end_time; anything else goes into the notes so it isn't lost."""
    if "time_slot" not in {r[1] for r in conn.execute("PRAGMA table_info(races)")}:
        return
    from .timeutil import normalize, to_minutes
    for r in conn.execute("SELECT id, time_slot, notes FROM races WHERE time_slot != '' AND time = ''").fetchall():
        start, end = normalize(r["time_slot"])
        if to_minutes(start) is not None:
            conn.execute("UPDATE races SET time = ?, end_time = ? WHERE id = ?", (start, end, r["id"]))
        else:
            notes = f"{r['notes']}\n\n" if r["notes"] else ""
            conn.execute("UPDATE races SET notes = ? WHERE id = ?", (f"{notes}Time: {r['time_slot']}", r["id"]))


def _migrate_max_land(conn) -> None:
    """The sign-up form used to ask for "max outings this week" (water + land together); it now asks
    for max land sessions separately. Rename the column and keep what's left after the water outings."""
    have = {r[1] for r in conn.execute("PRAGMA table_info(signups)")}
    if "max_outings" not in have or "max_land" in have:
        return
    conn.execute("BEGIN")
    try:
        conn.execute("ALTER TABLE signups RENAME COLUMN max_outings TO max_land")
        conn.execute("UPDATE signups SET max_land = MAX(0, max_land - want_row - want_cox)")
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def _normalize_times(conn) -> None:
    """Store times as zero-padded 24h "HH:MM" (so they sort correctly); split "6:30-8pm" into start/end."""
    from .timeutil import normalize
    for table in ("outings", "signup_slots"):
        for r in conn.execute(f"SELECT id, time, end_time FROM {table}").fetchall():
            start, end = normalize(r["time"])
            end = normalize(r["end_time"])[0] if r["end_time"] else end
            if (start, end) != (r["time"], r["end_time"]):
                conn.execute(f"UPDATE {table} SET time = ?, end_time = ? WHERE id = ?", (start, end, r["id"]))


def run(conn) -> None:
    _migrate_max_land(conn)
    for table, cols in MIGRATIONS.items():
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for col, decl in cols.items():
            if col not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    _migrate_task_repeat(conn)
    _migrate_coaches_table(conn)
    _migrate_coach_tag(conn)
    _migrate_race_times(conn)
    conn.execute("UPDATE members SET active = 0 WHERE category = 'Coach' AND active != 0")   # coaches are always inactive (nothing else is touched)
    for table, col in DROPPED_COLUMNS:
        if col in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
    _normalize_times(conn)
    # Races used to have a separate "Cox only" answer; it's now Available + the cox role.
    conn.execute("UPDATE race_responses SET status = 'yes', role = 'cox', squad = '', side = '' WHERE status = 'cox'")
