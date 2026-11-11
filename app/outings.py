"""Outings for the committee (create, edit, cancel, publish and copy weeks, the seat picker's eligibility),
plus the river rules and weather forecast shown with each session."""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import crewlog, db, push, river, weather
from .auth import require_committee, require_member
from .common import (busy_at, cancel_open_subs, monday_param, optional_date, parse_date, parse_times, settle_open_subs, today,
                     visible_outing)
from .logic import CANCEL_REASONS, TZ, Rules, is_small_boat, monday_of, seat_list
from .signup import availability_for_outing, week_counts
from .timeutil import normalize as norm_time

router = APIRouter()


# --------------------------------------------------------------- editing ----
class OutingIn(BaseModel):
    kind: str = "water"
    date: str
    time: str = Field("", max_length=20)
    end_time: str = Field("", max_length=20)
    location: str = Field("", max_length=80)
    title: str = Field("", max_length=80)
    coach: str = Field("", max_length=120)
    boat_id: Optional[int] = None
    capacity: int = Field(8, ge=1, le=40)
    coxed: bool = True
    notes: str = Field("", max_length=500)
    published: Optional[bool] = None
    seats: dict[str, Optional[int]] = {}


def _save_outing(conn, rules: Rules, oid: Optional[int], b: OutingIn, msgs: list, who: Optional[dict] = None) -> int:
    """Create or update an outing and its crew. Notifications for the change are added to `msgs`;
    crew changes to an already-published outing are logged as made by `who`."""
    before = push.snapshot(conn, ids=[oid] if oid else [])
    crew_before = crewlog.state(conn, oid)
    if b.kind not in ("water", "land"):
        raise HTTPException(400, "Kind must be water or land")
    parse_date(b.date)
    cap, coxed = b.capacity, b.coxed
    if b.kind == "water":
        if b.boat_id:
            boat = conn.execute("SELECT * FROM boats WHERE id=?", (b.boat_id,)).fetchone()
            if not boat:
                raise HTTPException(400, "Unknown boat")
            cap, coxed = boat["seats"], bool(boat["coxed"])
        cap = min(cap, 8)
    else:
        coxed = False
        b.boat_id = None
    valid_seats = set(seat_list(b.kind, cap, coxed))
    seats: dict[int, int] = {}
    for k, mid in b.seats.items():
        if mid is None or int(k) not in valid_seats:
            continue
        if mid not in rules.members:
            raise HTTPException(400, "Unknown member in seat list")
        if mid in seats.values():
            raise HTTPException(400, f"{rules.members[mid]['name']} is in two seats")
        seats[int(k)] = mid
    start, end = parse_times(b.time, b.end_time)
    fields = (b.kind, b.date, start, end, b.location.strip(), b.title.strip(), b.coach.strip(),
              b.boat_id, cap, int(coxed), b.notes)
    if oid is None:
        cur = conn.execute(
            """INSERT INTO outings(kind, date, time, end_time, location, title, coach, boat_id, capacity, coxed, notes, published)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", fields + (int(bool(b.published)),))
        oid = cur.lastrowid
    else:
        if not conn.execute("SELECT 1 FROM outings WHERE id=?", (oid,)).fetchone():
            raise HTTPException(404, "Outing not found")
        conn.execute(
            """UPDATE outings SET kind=?, date=?, time=?, end_time=?, location=?, title=?, coach=?, boat_id=?, capacity=?,
               coxed=?, notes=? WHERE id=?""", fields + (oid,))
        if b.published is not None:
            conn.execute("UPDATE outings SET published=? WHERE id=?", (int(b.published), oid))
    # replace seat assignments; an open sub request whose requester left the seat counts as filled by
    # whoever now sits there, or is cancelled if the seat is empty
    conn.execute("DELETE FROM assignments WHERE outing_id=?", (oid,))
    conn.executemany("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?,?,?)", [(oid, s, m) for s, m in seats.items()])
    for requester, sub in settle_open_subs(conn, oid, seats, fill=True):
        msgs += push.sub_filled(conn, oid, requester, sub)
    crewlog.compact_land(conn, oid)   # a land session is a list: close gaps the committee left, keeping the order
    if who is not None:
        crewlog.record(conn, oid, crew_before, who, "committee")
    msgs += push.crew_changes(conn, before, extra_ids=[oid])
    return oid


@router.post("/api/committee/outings")
def outing_create(b: OutingIn, _: str = Depends(require_committee)):
    msgs: list = []
    with db.get_conn() as conn:
        oid = _save_outing(conn, Rules(conn), None, b, msgs)  # new outings have no crew to change yet
    push.dispatch(msgs)
    return {"id": oid}


@router.put("/api/committee/outings/{oid}")
def outing_update(oid: int, b: OutingIn, request: Request, _: str = Depends(require_committee)):
    msgs: list = []
    with db.get_conn() as conn:
        oid = _save_outing(conn, Rules(conn), oid, b, msgs, crewlog.actor(request, conn))
    push.dispatch(msgs)
    return {"id": oid}


class OutingStatusIn(BaseModel):
    status: str                                    # cancelled | scheduled (= restore)
    category: str = ""                             # cancelled only: a CANCEL_REASONS key
    reason: str = Field("", max_length=200)        # cancelled only: optional note


@router.post("/api/committee/outings/{oid}/status")
def outing_status_set(oid: int, b: OutingStatusIn, _: str = Depends(require_committee)):
    """Cancel a session or restore it. Cancelled sessions stay on the schedule with their crew, but no
    longer count towards outing totals, free outings, stats or double-booking, and open sub requests close.
    "scheduled" clears the cancellation."""
    with db.get_conn() as conn:
        if not conn.execute("SELECT 1 FROM outings WHERE id=?", (oid,)).fetchone():
            raise HTTPException(404, "Outing not found")
        if b.status == "cancelled":
            if b.category not in CANCEL_REASONS:
                raise HTTPException(400, "Pick a reason for the cancellation")
            conn.execute("UPDATE outings SET cancelled=1, cancel_category=?, cancel_reason=? WHERE id=?",
                         (b.category, b.reason.strip(), oid))
            cancel_open_subs(conn, oid)
        elif b.status == "scheduled":
            conn.execute("UPDATE outings SET cancelled=0, cancel_category='', cancel_reason='' WHERE id=?", (oid,))
        else:
            raise HTTPException(400, "Unknown status")
        return {"ok": True}


@router.delete("/api/committee/outings/{oid}")
def outing_delete(oid: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM outings WHERE id=?", (oid,))
        return {"ok": True}


class CandidatesIn(BaseModel):
    kind: str
    date: str
    time: str = ""
    outing_id: Optional[int] = None
    capacity: int = 8
    coxed: bool = False


@router.post("/api/committee/candidates")
def candidates(b: CandidatesIn, _: str = Depends(require_committee)):
    """Eligibility of every member for a (possibly unsaved) outing — powers the seat picker."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        d = parse_date(b.date)
        b.time = norm_time(b.time)[0]
        key = (b.date, b.time, b.outing_id or 10**12)
        busy = busy_at(conn, {"date": b.date, "time": b.time}, b.outing_id)
        small = is_small_boat(b.kind, b.capacity, b.coxed)
        same_day = defaultdict(int)
        for r in conn.execute(
                """SELECT a.member_id FROM assignments a JOIN outings o ON o.id=a.outing_id
                   WHERE o.date=? AND o.id != ?""", (b.date, b.outing_id or -1)):
            same_day[r["member_id"]] += 1
        # sign-up form answers for this week + scheduled counts, to compare against their maximums
        su = availability_for_outing(conn, b.kind, b.date, b.time)
        week = week_counts(conn, monday_of(d).isoformat(), b.outing_id)
        out = {}
        for mid in rules.members:
            e = rules.check(mid, b.kind, d, key, small_boat=small)
            out[str(mid)] = {"ok": e["ok"], "reasons": e["reasons"], "note": e["note"],
                             "busy": mid in busy, "same_day": same_day.get(mid, 0),
                             "week": week.get(mid, {"row": 0, "cox": 0, "land": 0}),
                             "signup": su["members"].get(mid)}
        return {"members": out, "has_slots": su["has_slots"]}


# ----------------------------------------------------------------- weeks ----
class WeekIn(BaseModel):
    start: str
    published: bool = True


@router.post("/api/committee/week/publish")
def week_publish(b: WeekIn, _: str = Depends(require_committee)):
    ws = monday_param(b.start)
    span = (ws.isoformat(), (ws + timedelta(days=6)).isoformat())
    with db.get_conn() as conn:
        before = push.snapshot(conn, start=span[0], end=span[1])
        for table in ("outings", "socials"):
            conn.execute(f"UPDATE {table} SET published=? WHERE date BETWEEN ? AND ?", (int(b.published), *span))
        msgs = push.crew_changes(conn, before)
    push.dispatch(msgs)
    return {"ok": True}


class CopyWeekIn(BaseModel):
    source: str
    target: str
    include_crews: bool = False


@router.post("/api/committee/week/copy")
def week_copy(b: CopyWeekIn, _: str = Depends(require_committee)):
    src, dst = monday_param(b.source), monday_param(b.target)
    if src == dst:
        raise HTTPException(400, "Source and target week are the same")
    delta = dst - src
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM outings WHERE date BETWEEN ? AND ? ORDER BY date, time, id",
                            (src.isoformat(), (src + timedelta(days=6)).isoformat())).fetchall()
        for o in rows:
            nd = (parse_date(o["date"]) + delta).isoformat()
            cur = conn.execute(
                """INSERT INTO outings(kind, date, time, end_time, location, title, coach, boat_id, capacity, coxed, notes, published)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,0)""",
                (o["kind"], nd, o["time"], o["end_time"], o["location"], o["title"], o["coach"], o["boat_id"], o["capacity"],
                 o["coxed"], o["notes"]))
            if b.include_crews:
                conn.execute("""INSERT INTO assignments(outing_id, seat, member_id)
                                SELECT ?, seat, member_id FROM assignments WHERE outing_id=?""", (cur.lastrowid, o["id"]))
        return {"copied": len(rows)}


# ------------------------------------------------------------- weather ----
@router.get("/api/outings/{outing_id}/weather")
def outing_weather(outing_id: int, role: str = Depends(require_member)):
    """Forecast for a session (Open-Meteo), loaded when its popup opens."""
    with db.get_conn() as conn:
        o = dict(visible_outing(conn, outing_id, role, "Session"))
        place = conn.execute("SELECT lat, lon FROM places WHERE name = ? COLLATE NOCASE", (o.get("location") or "",)).fetchone()
        day = today(conn)
    # The (possibly slow) fetch happens outside the database connection.
    return weather.for_outing(o, dict(place) if place else None, day)


# --------------------------------------------------------------- river ----
@router.get("/api/river")
def river_info(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        s = rules.settings
        return {
            "flag": river.current_flag(s), "rules": river.RULES_TEXT, "flags": river.FLAGS,
            "rules_page": river.RULES_PAGE, "today": river.day_info(rules.today, TZ),
            "term": river.term_info(s, rules.today), "current_term": s.get("current_term"),
            "settings": {k: s.get(k, "") for k in ("term_start", "peak_end", "peak_crews_before_8")},
        }


class RiverCheckIn(BaseModel):
    date: str
    time: str = ""
    end_time: str = ""
    coach: str = ""
    boat_id: Optional[int] = None
    capacity: int = Field(8, ge=1, le=8)
    coxed: bool = True
    seats: dict[str, Optional[int]] = {}
    outing_id: Optional[int] = None


@router.post("/api/committee/river-check")
def river_check(b: RiverCheckIn, _: str = Depends(require_committee)):
    """River-rule warnings for an outing being edited (not saved yet)."""
    d = parse_date(b.date)
    with db.get_conn() as conn:
        rules = Rules(conn)
        boat = dict(r) if b.boat_id and (r := conn.execute("SELECT * FROM boats WHERE id=?", (b.boat_id,)).fetchone()) else None
        start, end = norm_time(b.time)[0], norm_time(b.end_time)[0] if b.end_time.strip() else ""
        o = {"kind": "water", "date": b.date, "time": start, "end_time": end, "coach": b.coach,
             "capacity": boat["seats"] if boat else b.capacity, "coxed": bool(boat["coxed"]) if boat else b.coxed}
        crew = {int(k): v for k, v in b.seats.items() if v is not None and k.lstrip("-").isdigit()}
        others = [dict(r) for r in conn.execute(
            "SELECT id, kind, date, time, end_time, capacity FROM outings WHERE kind='water' AND cancelled = 0 AND date=? AND id != ?",
            (b.date, b.outing_id or -1))]
        flag = river.current_flag(rules.settings)
        return {"flag": flag, "day": river.day_info(d, TZ),
                "issues": river.check_outing(o, crew, rules.members, boat, rules.settings, flag, rules.today, TZ, others)}


class RiverSettingsIn(BaseModel):
    term_start: str = ""
    peak_end: str = ""
    peak_crews_before_8: int = Field(1, ge=1, le=5)


@router.put("/api/committee/river-settings")
def river_settings(b: RiverSettingsIn, _: str = Depends(require_committee)):
    term_start = optional_date(b.term_start, f"Bad date: {b.term_start}")
    peak_end = optional_date(b.peak_end, f"Bad date: {b.peak_end}")
    if term_start and parse_date(term_start).weekday() != 6:
        raise HTTPException(400, "Full Term starts on a Sunday (Sunday of 1st week)")
    with db.get_conn() as conn:
        db.set_setting(conn, "term_start", term_start)
        db.set_setting(conn, "peak_end", peak_end)
        db.set_setting(conn, "peak_crews_before_8", str(b.peak_crews_before_8))
    return {"ok": True}


@router.post("/api/committee/river/refresh")
def river_refresh(_: str = Depends(require_committee)):
    river.refresh_now(db)
    with db.get_conn() as conn:
        return river.current_flag(db.get_settings(conn))
