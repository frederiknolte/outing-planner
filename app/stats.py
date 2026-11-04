"""Fun season statistics and awards (leaderboard), visible to every signed-in user.

Only sessions that have already happened (date before "today") and were published
count, from the season start onwards. Nothing about subs or swim tests is exposed.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta
from itertools import combinations

from fastapi import APIRouter, Depends

from . import db
from .auth import require_member
from .logic import CANCEL_REASONS, Rules, monday_of, outing_status

router = APIRouter()

EARLY_BEFORE = "08:00"   # start time strictly before this = early bird
LATE_FROM = "18:00"      # start time at or after this = night owl
MILESTONES = [1, 5, 10, 25, 50, 75, 100, 150, 200, 300]
TOP_N = 5


def _season_start(rules: Rules) -> date:
    try:
        return date.fromisoformat(rules.settings.get("season_start") or "")
    except ValueError:
        t = rules.today
        return date(t.year if t.month >= 9 else t.year - 1, 10, 1)


def _term_start(rules: Rules, season: date) -> date:
    """Start of "this term" for the attendance summary: two weeks before 1st week (pre-term training),
    but never before the season start."""
    try:
        t = date.fromisoformat(rules.settings.get("term_start") or "") - timedelta(days=14)
    except ValueError:
        return season
    return max(t, season) if t <= rules.today else season


def _outcomes(conn, rules: Rules, since: date) -> dict:
    """What became of the published sessions from `since` on: how many went ahead (past and not
    cancelled), how many were cancelled and why. Cancellations count even if they're in the future."""
    rows = conn.execute("""SELECT id, kind, date, cancelled, cancel_category FROM outings
                           WHERE published = 1 AND date >= ?""", (since.isoformat(),)).fetchall()
    n = Counter()
    kinds = {"water": Counter(), "land": Counter()}
    reasons = {k: Counter() for k in (*CANCEL_REASONS, "")}
    for r in rows:
        st = outing_status(dict(r), rules.today)
        if st == "scheduled":
            continue
        n[st] += 1
        kinds[r["kind"]][st] += 1
        if st == "cancelled":
            reasons[r["cancel_category"] if r["cancel_category"] in CANCEL_REASONS else ""][r["kind"]] += 1
    by_reason = [{"key": k, "label": CANCEL_REASONS.get(k, "No reason given"),
                  "count": sum(c.values()), "water": c["water"], "land": c["land"]}
                 for k, c in reasons.items() if c]
    by_reason.sort(key=lambda x: -x["count"])
    return {
        "since": since.isoformat(),
        "happened": n["past"], "cancelled": n["cancelled"],
        "water": {"happened": kinds["water"]["past"], "cancelled": kinds["water"]["cancelled"]},
        "land": {"happened": kinds["land"]["past"], "cancelled": kinds["land"]["cancelled"]},
        "by_reason": by_reason,
    }


def _longest_week_streak(weeks: set[date], this_week: date) -> tuple[int, int]:
    """(longest run of consecutive weeks with a session, current run ending this or last week)."""
    if not weeks:
        return 0, 0
    ordered = sorted(weeks)
    best = run = 1
    for a, b in zip(ordered, ordered[1:]):
        run = run + 1 if (b - a).days == 7 else 1
        best = max(best, run)
    # current streak: counts back from this week (or last week, if nothing yet this week)
    cur, w = 0, this_week if this_week in weeks else this_week - timedelta(days=7)
    while w in weeks:
        cur += 1
        w -= timedelta(days=7)
    return best, cur


@router.get("/api/stats")
def season_stats(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        start = _season_start(rules)
        today = rules.today
        this_week = monday_of(today)
        active = {mid: m for mid, m in rules.members.items() if m["active"]}

        rows = conn.execute(
            """SELECT a.member_id, a.seat, o.id AS oid, o.kind, o.date, o.time, o.boat_id
               FROM assignments a JOIN outings o ON o.id = a.outing_id
               WHERE o.published = 1 AND o.cancelled = 0 AND o.date >= ? AND o.date < ?""",
            (start.isoformat(), today.isoformat())).fetchall()
        subs = conn.execute(
            """SELECT s.sub_id FROM sub_requests s JOIN outings o ON o.id = s.outing_id
               WHERE s.status = 'filled' AND s.sub_id IS NOT NULL AND o.cancelled = 0 AND o.date >= ?""",
            (start.isoformat(),)).fetchall()

        c = {k: Counter() for k in ("water", "land", "total", "early", "late", "weekend", "cox", "subs")}
        boats_used: dict[int, set] = defaultdict(set)
        weeks: dict[int, set] = defaultdict(set)
        crews: dict[int, list] = defaultdict(list)     # water outing -> rowers/cox
        week_total, last_week_total = 0, 0
        dow_counts = Counter()
        sessions = set()
        for r in rows:
            mid = r["member_id"]
            if mid not in active:
                continue
            d = date.fromisoformat(r["date"])
            sessions.add(r["oid"])
            c[r["kind"]][mid] += 1
            c["total"][mid] += 1
            if r["time"] and r["time"] < EARLY_BEFORE:
                c["early"][mid] += 1
            if r["time"] and r["time"] >= LATE_FROM:
                c["late"][mid] += 1
            if d.weekday() >= 5:
                c["weekend"][mid] += 1
            if r["kind"] == "water" and r["seat"] == 0:
                c["cox"][mid] += 1
            if r["kind"] == "water":
                crews[r["oid"]].append(mid)
                if r["boat_id"]:
                    boats_used[mid].add(r["boat_id"])
            weeks[mid].add(monday_of(d))
            dow_counts[d.weekday()] += 1
            if monday_of(d) == this_week:
                week_total += 1
            elif monday_of(d) == this_week - timedelta(days=7):
                last_week_total += 1
        for s in subs:
            if s["sub_id"] in active:
                c["subs"][s["sub_id"]] += 1

        pairs = Counter()
        for crew in crews.values():
            for a, b in combinations(sorted(set(crew)), 2):
                pairs[(a, b)] += 1
        streaks = {mid: _longest_week_streak(w, this_week) for mid, w in weeks.items()}

        name = lambda mid: active[mid]["name"]  # noqa: E731

        def board(counter: dict, unit: str) -> list[dict]:
            ranked = sorted(((v, mid) for mid, v in counter.items() if v > 0), key=lambda x: (-x[0], name(x[1]).lower()))
            out, prev, rank = [], None, 0
            for i, (v, mid) in enumerate(ranked[:TOP_N]):
                if v != prev:
                    rank, prev = i + 1, v
                out.append({"id": mid, "name": name(mid), "value": v, "rank": rank, "unit": unit})
            return out

        def mine(counter: dict) -> dict:
            """Each member's value and rank on this board (for highlighting 'you')."""
            vals = [v for v in counter.values() if v > 0]
            return {mid: {"value": v, "rank": 1 + sum(x > v for x in vals)} for mid, v in counter.items() if v > 0}

        boards_def = [
            ("water", "On the water", "Most water outings", "outings", c["water"]),
            ("land", "Land legend", "Most land sessions", "sessions", c["land"]),
            ("total", "Ever-present", "Most sessions overall", "sessions", c["total"]),
            ("early", "Early bird", f"Most sessions starting before {EARLY_BEFORE}", "sessions", c["early"]),
            ("late", "Night owl", f"Most sessions starting from {LATE_FROM}", "sessions", c["late"]),
            ("weekend", "Weekend warrior", "Most Saturday & Sunday sessions", "sessions", c["weekend"]),
            ("cox", "Voice of the boat", "Most outings coxed", "outings", c["cox"]),
            ("subs", "Super sub", "Most seats filled for others", "subs", c["subs"]),
            ("streak", "Iron streak", "Longest run of weeks in a row with a session", "weeks",
             {mid: s[0] for mid, s in streaks.items()}),
            ("boats", "Boat collector", "Rowed in the most different boats", "boats",
             {mid: len(b) for mid, b in boats_used.items()}),
        ]
        boards = []
        for key, title, desc, unit, counter in boards_def:
            entries = board(counter, unit)
            boards.append({"key": key, "title": title, "desc": desc, "unit": unit, "entries": entries,
                           "me": {str(k): v for k, v in mine(counter).items()}})

        top_pairs = [{"a": name(a), "b": name(b), "ids": [a, b], "value": v}
                     for (a, b), v in sorted(pairs.items(), key=lambda x: (-x[1], name(x[0][0])))[:TOP_N]]

        # Personal milestones and badges (every active member, so the "My outings" page can show them)
        def next_milestone(n: int):
            return next((m for m in MILESTONES if m > n), None)

        people = {}
        for mid, m in active.items():
            total_all = m["past_water"] + m["past_land"] + rules.counts[mid]["water_done"] + rules.counts[mid]["land_done"]
            badges = [b["title"] for b in boards if b["entries"] and any(e["id"] == mid and e["rank"] == 1 for e in b["entries"])]
            nm = next_milestone(total_all)
            people[str(mid)] = {
                "season_total": c["total"][mid], "all_time": total_all,
                "streak": streaks.get(mid, (0, 0))[0], "current_streak": streaks.get(mid, (0, 0))[1],
                "early": c["early"][mid], "subs": c["subs"][mid], "cox": c["cox"][mid],
                "boats": len(boats_used[mid]),
                "badges": badges,
                "milestone": {"reached": max([x for x in MILESTONES if x <= total_all], default=0),
                              "next": nm, "to_go": (nm - total_all) if nm else 0},
                "buddy": next(({"name": name(b if a == mid else a), "value": v}
                               for (a, b), v in sorted(pairs.items(), key=lambda x: -x[1]) if mid in (a, b)), None),
            }

        term_from = _term_start(rules, start)
        outcomes = {"term_name": rules.settings.get("current_term") or "Term",
                    "term": _outcomes(conn, rules, term_from),
                    "season": _outcomes(conn, rules, start)}

        busiest = max(dow_counts.items(), key=lambda x: x[1])[0] if dow_counts else None
        return {
            "season_start": start.isoformat(),
            "today": today.isoformat(),
            "club": {
                "seat_sessions": sum(c["total"].values()),
                "sessions": len(sessions),
                "active_rowers": len([m for m in c["total"] if c["total"][m] > 0]),
                "this_week": week_total, "last_week": last_week_total,
                "busiest_day": busiest,
                "subs_filled": sum(c["subs"].values()),
            },
            "boards": boards,
            "pairs": top_pairs,
            "outcomes": outcomes,
            "people": people,
        }
