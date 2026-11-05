"""Rollover: move the club on to the next term, and once a year on to the next academic year.

The committee previews what will change, adjusts it, and applies it all at once.

Every term (Michaelmas -> Hilary -> Trinity):

* roll over the term: current term, Sunday of 1st week (from the University's dates, see terms.py)
  and the subs cutoff (moved to the same point of the new term). The regatta date (peak_end) is
  cleared, since it belongs to the old term.
* reset termly subs: Single-term subs for the old term go back to Unpaid; full-year subs stay.
* move novices to senior: the ticked novices become Senior.

At the end of the year (Trinity -> Michaelmas), additionally:

* archive the season: the leaderboard, boat usage, committee roster, handbook and a subs
  summary are saved as a snapshot (season_archives). Everyone can still browse the archived
  leaderboard; the full snapshot is for the committee.
* next academic year and season start; everyone's subs go back to Unpaid (except anyone who
  already paid for the new year).

The committee itself usually changes in March, so it's handed over separately (the roster on the
same page, saved through /api/committee/club-committee). The handbook is kept as it is.

Outing history isn't touched: all-time totals and the "past outings" baselines stay as they are.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, terms
from .auth import require_committee, require_member
from .committee_roster import POSITIONS, roster
from .logic import Rules
from .stats import season_stats
from .usage import boat_usage

router = APIRouter()

SETTINGS_ROLLED = ("academic_year", "current_term", "season_start", "term_start", "peak_end", "subs_cutoff")
next_academic_year = terms.next_academic_year


def _plus_year(iso: str) -> str:
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return ""
    try:
        return d.replace(year=d.year + 1).isoformat()
    except ValueError:                       # 29 February
        return d.replace(year=d.year + 1, day=28).isoformat()


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


def _novices(conn, rules: Rules, since: str) -> list[dict]:
    recent = {r["member_id"]: r["n"] for r in conn.execute(
        """SELECT a.member_id, COUNT(*) n FROM assignments a JOIN outings o ON o.id = a.outing_id
           WHERE o.cancelled = 0 AND o.date >= ? AND o.date < ? GROUP BY a.member_id""",
        (since or "0000", rules.today.isoformat()))}
    out = []
    for mid, m in rules.members.items():
        if m["category"] != "Novice":
            continue
        c = rules.counts[mid]
        total = m["past_water"] + m["past_land"] + c["water_done"] + c["land_done"]
        out.append({"id": mid, "name": m["name"], "active": bool(m["active"]), "recent": recent.get(mid, 0),
                    "all_time": total, "suggest": bool(m["active"]) and total > 0})
    out.sort(key=lambda x: (not x["active"], -x["all_time"], x["name"].lower()))
    return out


def _not_started(settings: dict, today: date) -> bool:
    """The current term (or season) hasn't begun yet, i.e. the rollover has just been done: don't do it twice."""
    for k in ("term_start", "season_start"):
        try:
            if today < date.fromisoformat(settings.get(k) or ""):
                return True
        except ValueError:
            pass
    return False


def _next(s: dict) -> dict:
    """Where the rollover goes from the current settings."""
    ay, term = s.get("academic_year", ""), s.get("current_term", "")
    nay, nterm = terms.next_term(ay, term)
    ft = terms.full_term(nay, nterm) or {"start": "", "end": "", "official": False}
    return {"academic_year": nay, "term": nterm, "yearly": nterm == terms.TERMS[0], **ft}


def _archives(conn) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT id, academic_year, season_start, season_end, created_at FROM season_archives ORDER BY season_start DESC, id DESC")]


@router.get("/api/committee/handover")
def handover_preview(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        s = rules.settings
        ay = s.get("academic_year", "")
        nxt = _next(s)
        cur_ft = terms.full_term(ay, s.get("current_term", "")) or {}
        out = {
            "today": rules.today.isoformat(),
            "current": {k: s.get(k, "") for k in SETTINGS_ROLLED},
            "current_end": cur_ft.get("end", ""),
            "next": nxt,
            "proposed": {
                "academic_year": nxt["academic_year"],
                "current_term": nxt["term"],
                "season_start": _plus_year(s.get("season_start", "")) if nxt["yearly"] else s.get("season_start", ""),
                "term_start": nxt["start"],
                "peak_end": "",
                "subs_cutoff": terms.shift_to_next_term(s["subs_cutoff"]) if s.get("subs_cutoff") else "",
            },
            "already_archived": nxt["yearly"] and bool(conn.execute("SELECT 1 FROM season_archives WHERE academic_year = ?", (ay,)).fetchone()),
            "not_started": _not_started(s, rules.today),
            "subs": _subs_summary(conn, s),
            "novices": _novices(conn, rules, s.get("season_start", "") if nxt["yearly"] else
                                (date.fromisoformat(s["term_start"]) - timedelta(days=14)).isoformat() if s.get("term_start") else ""),
            "positions": [{"key": k, "label": l, "max": n} for k, l, n in POSITIONS],
            "holders": roster(conn),
            "handbook_chars": len(s.get("committee_handbook", "") or ""),
            "archives": _archives(conn),
        }
        if nxt["yearly"]:
            stats = season_stats("committee")
            out["season"] = {"start": stats["season_start"], **{k: stats["club"][k] for k in ("seat_sessions", "sessions", "active_rowers")},
                             "cancelled": stats["outcomes"]["season"]["cancelled"]}
        return out


class HandoverIn(BaseModel):
    term_start: str
    subs_cutoff: str = ""
    reset_subs: bool = True
    promote: list[int] = []
    # end of the year only
    academic_year: str = Field("", max_length=20)
    season_start: str = ""


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
    term_start = _date(b.term_start, "the Full Term start", required=True)
    _date(b.subs_cutoff, "the subs cutoff")
    if term_start.weekday() != 6:
        raise HTTPException(400, "Full Term starts on a Sunday (Sunday of 1st week)")

    with db.get_conn() as conn:
        rules = Rules(conn)
        s = rules.settings
        old_ay, old_term = s.get("academic_year", ""), s.get("current_term", "")
        nxt = _next(s)
        yearly = nxt["yearly"]
        if _not_started(s, rules.today):
            raise HTTPException(409, f"{old_term} {old_ay} hasn't started yet, so it's too early to move on")
        old_ts = _date(s.get("term_start", ""), "the current Full Term start")
        if old_ts and term_start <= old_ts:
            raise HTTPException(400, "The new term must start after the current one")
        new_ay, new_season = old_ay, None
        if yearly:
            new_ay = b.academic_year.strip() or nxt["academic_year"]
            new_season = _date(b.season_start, "the new season start", required=True)
            if new_ay == old_ay:
                raise HTTPException(400, "The new academic year must differ from the current one")
            if conn.execute("SELECT 1 FROM season_archives WHERE academic_year = ?", (old_ay,)).fetchone():
                raise HTTPException(409, f"{old_ay} has already been archived")
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

    if yearly:
        # Snapshot the season before anything changes (these read with their own connections).
        stats = season_stats("committee")
        usage = boat_usage("season", "committee")
        season_end = min(rules.today, new_season) - timedelta(days=1)

    with db.get_conn() as conn:
        if yearly:
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
                raise HTTPException(409, f"{old_ay} has already been archived")

        if promote:
            conn.execute(f"UPDATE members SET category = 'Senior' WHERE category = 'Novice' AND id IN ({','.join('?' * len(promote))})",
                         tuple(promote))
        reset = 0
        if b.reset_subs:
            # Anyone who has already paid for the new term keeps it (full year: for the new academic year).
            reset = conn.execute("""UPDATE members SET subs_plan = 'Unpaid', subs_term = '', subs_year = '', subs_reminded_at = ''
                                    WHERE NOT ((subs_plan = 'Full year' AND TRIM(subs_year) = ?)
                                               OR (subs_plan = 'Single term' AND TRIM(subs_year) = ? AND subs_term = ?))
                                      AND (subs_plan != 'Unpaid' OR subs_year != '' OR subs_term != '' OR subs_reminded_at != '')""",
                                 (new_ay, new_ay, nxt["term"])).rowcount
        new = {"current_term": nxt["term"], "term_start": term_start.isoformat(), "peak_end": "", "subs_cutoff": b.subs_cutoff}
        if yearly:
            new.update(academic_year=new_ay, season_start=new_season.isoformat())
        for k, v in new.items():
            db.set_setting(conn, k, v)
        return {"ok": True, "yearly": yearly, "archived": old_ay if yearly else None, "promoted": len(promote),
                "subs_reset": reset, "settings": {**{k: s.get(k, "") for k in SETTINGS_ROLLED}, **new}}


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
