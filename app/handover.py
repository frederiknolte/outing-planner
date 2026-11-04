"""Year-end handover: close one academic year and set up the next, in one step.

The committee previews what will change, adjusts it, and applies it all at once:

* archive the season: the leaderboard, boat usage, committee roster, handbook and a subs
  summary are saved as a snapshot (season_archives). Everyone can still browse the archived
  leaderboard; the full snapshot is for the committee.
* roll over the dates: next academic year, Michaelmas, season start, 1st-week Sunday, subs cutoff.
  The regatta date (peak_end) is cleared, since it belongs to the old term.
* reset subs: everyone goes back to Unpaid, except anyone who already paid for the new year.
* move novices to senior: the ticked novices become Senior.
* carry the committee forward: the roster is saved as entered for the incoming committee
  (prefilled with the current holders). The handbook is kept as it is.

Outing history isn't touched: all-time totals and the "past outings" baselines stay as they are.
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import require_committee, require_member
from .committee_roster import POSITIONS, HolderIn, clean_holders, roster, save_holders
from .logic import Rules
from .stats import season_stats
from .usage import boat_usage

router = APIRouter()

SETTINGS_ROLLED = ("academic_year", "current_term", "season_start", "term_start", "peak_end", "subs_cutoff")


def next_academic_year(ay: str) -> str:
    """'2026-27' -> '2027-28' ('2026/2027' -> '2027-28'); '' if it can't be read."""
    m = re.match(r"^\s*(\d{4})\s*[-/–]\s*(\d{2}|\d{4})\s*$", ay or "")
    if not m:
        return ""
    y = int(m.group(1)) + 1
    return f"{y}-{(y + 1) % 100:02d}"


def _plus_year(iso: str) -> str:
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return ""
    try:
        return d.replace(year=d.year + 1).isoformat()
    except ValueError:                       # 29 February
        return d.replace(year=d.year + 1, day=28).isoformat()


def _next_term_start(iso: str) -> str:
    """Same Sunday a year on (52 weeks later keeps the weekday); the committee checks the real date."""
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return ""
    d += timedelta(weeks=52)
    return (d + timedelta(days=(6 - d.weekday()) % 7)).isoformat()


def _subs_summary(conn, settings: dict) -> dict:
    ay, term = settings.get("academic_year", ""), settings.get("current_term", "")
    out = {"full_year": 0, "single_term": 0, "unpaid": 0}
    for m in conn.execute("SELECT subs_plan, subs_term, subs_year FROM members WHERE active = 1"):
        if m["subs_plan"] == "Full year" and m["subs_year"].strip() == ay:
            out["full_year"] += 1
        elif m["subs_plan"] == "Single term" and m["subs_year"].strip() == ay and m["subs_term"] == term:
            out["single_term"] += 1
        else:
            out["unpaid"] += 1
    return out


def _novices(conn, rules: Rules, season_start: str) -> list[dict]:
    season = {r["member_id"]: r["n"] for r in conn.execute(
        """SELECT a.member_id, COUNT(*) n FROM assignments a JOIN outings o ON o.id = a.outing_id
           WHERE o.cancelled = 0 AND o.date >= ? AND o.date < ? GROUP BY a.member_id""",
        (season_start or "0000", rules.today.isoformat()))}
    out = []
    for mid, m in rules.members.items():
        if m["category"] != "Novice":
            continue
        c = rules.counts[mid]
        total = m["past_water"] + m["past_land"] + c["water_done"] + c["land_done"]
        out.append({"id": mid, "name": m["name"], "active": bool(m["active"]), "season": season.get(mid, 0),
                    "all_time": total, "suggest": bool(m["active"]) and total > 0})
    out.sort(key=lambda x: (not x["active"], -x["all_time"], x["name"].lower()))
    return out


def _not_started(settings: dict, today: date) -> bool:
    """The current season hasn't begun yet, i.e. the handover has just been done: don't do it twice."""
    try:
        return today < date.fromisoformat(settings.get("season_start") or "")
    except ValueError:
        return False


def _archives(conn) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT id, academic_year, season_start, season_end, created_at FROM season_archives ORDER BY season_start DESC, id DESC")]


@router.get("/api/committee/handover")
def handover_preview(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        s = rules.settings
        ay = s.get("academic_year", "")
        stats = season_stats("committee")
        return {
            "today": rules.today.isoformat(),
            "current": {k: s.get(k, "") for k in SETTINGS_ROLLED},
            "proposed": {
                "academic_year": next_academic_year(ay),
                "current_term": "Michaelmas",
                "season_start": _plus_year(s.get("season_start", "")),
                "term_start": _next_term_start(s.get("term_start", "")),
                "peak_end": "",
                "subs_cutoff": _plus_year(s.get("subs_cutoff", "")) if s.get("subs_cutoff") else "",
            },
            "already_archived": bool(conn.execute("SELECT 1 FROM season_archives WHERE academic_year = ?", (ay,)).fetchone()),
            "not_started": _not_started(s, rules.today),
            "season": {"start": stats["season_start"], **{k: stats["club"][k] for k in ("seat_sessions", "sessions", "active_rowers")},
                       "cancelled": stats["outcomes"]["season"]["cancelled"]},
            "subs": _subs_summary(conn, s),
            "novices": _novices(conn, rules, s.get("season_start", "")),
            "positions": [{"key": k, "label": l, "max": n} for k, l, n in POSITIONS],
            "holders": roster(conn),
            "handbook_chars": len(s.get("committee_handbook", "") or ""),
            "archives": _archives(conn),
        }


class HandoverIn(BaseModel):
    academic_year: str = Field(..., min_length=1, max_length=20)
    season_start: str
    term_start: str = ""
    subs_cutoff: str = ""
    reset_subs: bool = True
    promote: list[int] = []
    holders: Optional[list[HolderIn]] = None      # None = keep the roster as it is


def _date(v: str, what: str, required: bool = False) -> Optional[date]:
    if not v:
        if required:
            raise HTTPException(400, f"{what} is required")
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise HTTPException(400, f"Bad date for {what}")


@router.post("/api/committee/handover")
def handover_apply(b: HandoverIn, _: str = Depends(require_committee)):
    new_ay = b.academic_year.strip()
    new_season = _date(b.season_start, "the new season start", required=True)
    term_start = _date(b.term_start, "Full Term start")
    _date(b.subs_cutoff, "the subs cutoff")
    if term_start and term_start.weekday() != 6:
        raise HTTPException(400, "Full Term starts on a Sunday (Sunday of 1st week)")
    clean = clean_holders(b.holders) if b.holders is not None else None

    with db.get_conn() as conn:
        rules = Rules(conn)
        s = rules.settings
        old_ay = s.get("academic_year", "")
        if new_ay == old_ay:
            raise HTTPException(400, "The new academic year must differ from the current one")
        if conn.execute("SELECT 1 FROM season_archives WHERE academic_year = ?", (old_ay,)).fetchone():
            raise HTTPException(409, f"{old_ay} has already been handed over")
        if _not_started(s, rules.today):
            raise HTTPException(409, f"{old_ay} hasn't started yet (the season starts {s['season_start']}), so there's nothing to hand over")
        old_season = _date(s.get("season_start", ""), "the current season start")
        if old_season and new_season <= old_season:
            raise HTTPException(400, "The new season must start after the current one")
        promote = set(b.promote)
        novices = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM members WHERE category = 'Novice'")}
        if promote - set(novices):
            raise HTTPException(400, "Only novices can be moved to senior")
        before_roster = roster(conn)
        subs = _subs_summary(conn, s)
        handbook = s.get("committee_handbook", "") or ""

    # Snapshot the season before anything changes (these read with their own connections).
    stats = season_stats("committee")
    usage = boat_usage("season", "committee")
    season_end = min(rules.today, new_season) - timedelta(days=1)

    with db.get_conn() as conn:
        data = {
            "stats": stats,
            "usage": {"totals": usage["totals"], "boats": [
                {k: x[k] for k in ("id", "name", "boat_type", "status", "outings", "hours")} for x in usage["boats"]]},
            "roster": {"positions": [{"key": k, "label": l, "max": n} for k, l, n in POSITIONS], "holders": before_roster},
            "handbook": handbook,
            "subs": subs,
            "promoted": sorted((novices[i] for i in promote), key=str.lower),
            "settings": {k: s.get(k, "") for k in SETTINGS_ROLLED},
        }
        try:
            conn.execute("INSERT INTO season_archives(academic_year, season_start, season_end, data) VALUES (?, ?, ?, ?)",
                         (old_ay, s.get("season_start", ""), season_end.isoformat(), json.dumps(data)))
        except db.sqlite3.IntegrityError:                 # someone else just handed over
            raise HTTPException(409, f"{old_ay} has already been handed over")

        if promote:
            conn.execute(f"UPDATE members SET category = 'Senior' WHERE category = 'Novice' AND id IN ({','.join('?' * len(promote))})",
                         tuple(promote))
        reset = 0
        if b.reset_subs:
            # Anyone who has already paid for the new year keeps it.
            reset = conn.execute("""UPDATE members SET subs_plan = 'Unpaid', subs_term = '', subs_year = '', subs_reminded_at = ''
                                    WHERE TRIM(subs_year) != ? AND (subs_plan != 'Unpaid' OR subs_year != '' OR subs_term != ''
                                                                    OR subs_reminded_at != '')""", (new_ay,)).rowcount
        if clean is not None:
            save_holders(conn, clean)
        new = {"academic_year": new_ay, "current_term": "Michaelmas", "season_start": new_season.isoformat(),
               "term_start": term_start.isoformat() if term_start else "", "peak_end": "", "subs_cutoff": b.subs_cutoff}
        for k, v in new.items():
            db.set_setting(conn, k, v)
        return {"ok": True, "archived": old_ay, "promoted": len(promote), "subs_reset": reset,
                "roster": "updated" if clean is not None else "kept", "settings": new}


# ------------------------------------------------------------------ archives --
def _load(conn, archive_id: int) -> tuple[dict, dict]:
    r = conn.execute("SELECT * FROM season_archives WHERE id = ?", (archive_id,)).fetchone()
    if not r:
        raise HTTPException(404, "No such season")
    return dict(r), json.loads(r["data"] or "{}")


@router.get("/api/stats/archives")
def archives_list(_: str = Depends(require_member)):
    with db.get_conn() as conn:
        return {"archives": _archives(conn)}


@router.get("/api/stats/archives/{archive_id}")
def archive_stats(archive_id: int, _: str = Depends(require_member)):
    """An archived season's leaderboard (the same shape as /api/stats), for everyone."""
    with db.get_conn() as conn:
        row, data = _load(conn, archive_id)
        return {**data.get("stats", {}), "archive": {k: row[k] for k in ("id", "academic_year", "season_start", "season_end")}}


@router.get("/api/committee/archives/{archive_id}")
def archive_full(archive_id: int, _: str = Depends(require_committee)):
    """Everything saved at handover except the leaderboard (which /api/stats/archives/{id} serves)."""
    with db.get_conn() as conn:
        row, data = _load(conn, archive_id)
        data.pop("stats", None)
        return {**{k: row[k] for k in ("id", "academic_year", "season_start", "season_end", "created_at")}, **data}
