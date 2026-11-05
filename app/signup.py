"""Weekly availability sign-up (replaces the club's old Google Form).

The committee defines the bookable slots for a week (water, erg or tank sessions) and
open the form. Rowers say who they are (an existing member, or a new name which
creates a member flagged for committee review), plus phone, college, role, how many
outings they want, side preference, squad (Open or Women's, for rowers), weekly
maximum, which slots they're free for, and whether they can bankride. The
committee's view counts each session's rowers per squad, so it's clear whether
there are enough people for an Open or a Women's crew.

Phone numbers are committee-only: no rower-facing endpoint ever returns them.
"""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import db, privacy
from .auth import require_committee, require_member
from .logic import effective_today, maps_url, monday_of
from .timeutil import normalize as norm_time, to_minutes

router = APIRouter()

COLLEGES = ["Reuben", "Blackfriars", "St Stephen's House", "Other"]
ROLES = {"rower": "Rower", "cox": "Cox", "both": "Rower & cox", "bankrider": "Bankrider / coach"}
SQUADS = {"open": "Open", "women": "Women's"}
SIDES = ["Bow side only", "Bow side preferred", "Equally happy", "Stroke side preferred", "Stroke side only"]
SLOT_KINDS = {"water": "Water", "erg": "Erg", "tank": "Tank"}


def _monday(s: str) -> str:
    try:
        return monday_of(date.fromisoformat(s)).isoformat()
    except ValueError:
        raise HTTPException(400, "Bad date")


def _week_row(conn, ws: str) -> dict:
    r = conn.execute("SELECT * FROM signup_weeks WHERE week_start = ?", (ws,)).fetchone()
    return dict(r) if r else {"week_start": ws, "open": 0, "note": ""}


def _slots(conn, ws: str) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM signup_slots WHERE week_start = ? ORDER BY date, time, id", (ws,))]


def slot_availability(conn, ws: str) -> dict:
    """{slot_id: set(member_id)} for a week."""
    out = defaultdict(set)
    for r in conn.execute(
            """SELECT a.slot_id, s.member_id FROM signup_availability a
               JOIN signups s ON s.id = a.signup_id WHERE s.week_start = ?""", (ws,)):
        out[r["slot_id"]].add(r["member_id"])
    return out


def availability_for_outing(conn, kind: str, d: str, time: str) -> dict:
    """Sign-up info per member for an outing on date d at time — used by the seat picker.

    A member counts as available if they ticked a slot on that date of a matching
    type (water for water outings, erg/tank for land) and, when both times are set,
    the same time.
    """
    ws = _monday(d)
    kinds = ("water",) if kind == "water" else ("erg", "tank")
    slots = [s for s in _slots(conn, ws) if s["date"] == d and s["kind"] in kinds]
    time = norm_time(time)[0]
    if time:
        timed = [s for s in slots if not s["time"] or s["time"] == time]
        slots = timed
    avail = slot_availability(conn, ws)
    free = set().union(*(avail.get(s["id"], set()) for s in slots)) if slots else set()
    info = {}
    for r in conn.execute("SELECT * FROM signups WHERE week_start = ?", (ws,)):
        info[r["member_id"]] = {
            "signed_up": True, "available": r["member_id"] in free, "role": r["role"],
            "side": r["side"], "squad": r["squad"], "max_land": r["max_land"], "want_row": r["want_row"],
            "want_cox": r["want_cox"], "can_bankride": bool(r["can_bankride"]),
        }
    return {"has_slots": bool(slots), "members": info}


def week_counts(conn, ws: str, exclude_outing: Optional[int] = None) -> dict:
    """Seats each member has in the week starting ws (not counting cancelled outings):
    {member_id: {"row": water rowing seats, "cox": coxing seats, "land": land sessions}}."""
    out = defaultdict(lambda: {"row": 0, "cox": 0, "land": 0})
    for r in conn.execute(
            """SELECT a.member_id, a.seat, o.kind FROM assignments a JOIN outings o ON o.id = a.outing_id
               WHERE o.cancelled = 0 AND o.date BETWEEN ? AND ? AND o.id != ?""",
            (ws, (date.fromisoformat(ws) + timedelta(days=6)).isoformat(), exclude_outing or -1)):
        out[r["member_id"]]["land" if r["kind"] == "land" else "cox" if r["seat"] == 0 else "row"] += 1
    return dict(out)


# ------------------------------------------------------------- rowers -----
@router.get("/api/signup")
def signup_forms(role: str = Depends(require_member)):
    """Open sign-up weeks (current or future) with their slots."""
    with db.get_conn() as conn:
        s = db.get_settings(conn)
        today = effective_today(s)
        this_week = monday_of(today).isoformat()
        places = {r["name"].lower(): dict(r) for r in conn.execute("SELECT * FROM places")}
        weeks = []
        for w in conn.execute("SELECT * FROM signup_weeks WHERE open = 1 AND week_start >= ? ORDER BY week_start",
                              (this_week,)):
            slots = [{**s, "maps_url": maps_url(places.get((s["location"] or "").strip().lower()))}
                     for s in _slots(conn, w["week_start"]) if s["date"] >= today.isoformat()]
            weeks.append({"week_start": w["week_start"], "note": w["note"], "slots": slots})
        days = int(s.get("phone_retention_days") or 0)
        return {"weeks": weeks, "colleges": COLLEGES, "roles": ROLES, "sides": SIDES, "squads": SQUADS, "slot_kinds": SLOT_KINDS,
                "phone_mode": privacy.phone_mode(s), "phone_retention_days": days}


@router.get("/api/signup/{week_start}/member/{member_id}")
def signup_prefill(week_start: str, member_id: int, role: str = Depends(require_member)):
    """Prefill for the form: the member's saved answers (never their phone number)."""
    ws = _monday(week_start)
    with db.get_conn() as conn:
        m = conn.execute("SELECT * FROM members WHERE id = ?", (member_id,)).fetchone()
        if not m:
            raise HTTPException(404, "Unknown member")
        s = conn.execute("SELECT * FROM signups WHERE week_start = ? AND member_id = ?", (ws, member_id)).fetchone()
        last = s or conn.execute("SELECT * FROM signups WHERE member_id = ? ORDER BY week_start DESC LIMIT 1",
                                 (member_id,)).fetchone()
        slot_ids = [r["slot_id"] for r in conn.execute(
            "SELECT slot_id FROM signup_availability WHERE signup_id = ?", (s["id"],))] if s else []
        college = m["college"] or (last["college"] if last else "")
        return {
            "existing": bool(s),
            "has_phone": bool(m["phone"]),
            "college": college,
            "side": m["side"] or (last["side"] if last else ""),
            "squad": m["squad"] or (last["squad"] if last else ""),
            "role": last["role"] if last else ("cox" if m["cox_status"] else "rower"),
            "want_row": last["want_row"] if last else None,
            "want_cox": last["want_cox"] if last else None,
            "max_land": last["max_land"] if last else None,
            "can_bankride": bool(s["can_bankride"]) if s else True,
            "comments": s["comments"] if s else "",
            "slot_ids": slot_ids,
        }


class SignupIn(BaseModel):
    week_start: str
    member_id: Optional[int] = None
    new_name: str = Field("", max_length=100)
    phone: str = Field("", max_length=40)
    college: str = Field(..., max_length=80)
    role: str
    want_row: int = Field(0, ge=0, le=21)
    want_cox: int = Field(0, ge=0, le=21)
    side: str = ""
    squad: str = ""
    max_land: int = Field(0, ge=0, le=21)
    can_bankride: bool = False
    slot_ids: list[int] = []
    comments: str = Field("", max_length=500)


@router.post("/api/signup")
def signup_submit(b: SignupIn, role: str = Depends(require_member)):
    ws = _monday(b.week_start)
    if b.role not in ROLES:
        raise HTTPException(400, "Pick what you're signing up as")
    college = b.college.strip()
    if not college:
        raise HTTPException(400, "Pick your college")
    rows = b.role in ("rower", "both")
    coxes = b.role in ("cox", "both")
    if rows and b.side not in SIDES:
        raise HTTPException(400, "Pick a side preference")
    if rows and b.squad not in SQUADS:
        raise HTTPException(400, "Pick your squad (Open or Women's)")
    squad = b.squad if rows else ""
    if rows and b.want_row < 1:
        raise HTTPException(400, "Set the maximum number of water outings for the week")
    if coxes and b.want_cox < 1:
        raise HTTPException(400, "How many coxing outings would you like?")
    phone = " ".join(b.phone.split())

    with db.get_conn() as conn:
        mode = privacy.phone_mode(db.get_settings(conn))
        if mode == "off":
            phone = ""  # not collected
        if phone and sum(c.isdigit() for c in phone) < 7:
            raise HTTPException(400, "That phone number looks too short")
        w = _week_row(conn, ws)
        if not w["open"] and role != "committee":
            raise HTTPException(400, "Sign-ups for this week are closed")
        valid_slots = {s["id"] for s in _slots(conn, ws)}
        slot_ids = sorted(set(b.slot_ids))
        if any(s not in valid_slots for s in slot_ids):
            raise HTTPException(400, "Some of those sessions no longer exist — refresh and try again")
        if not slot_ids and b.role != "bankrider":
            raise HTTPException(400, "Tick at least one session you're free for")

        # who is this?
        created = False
        if b.member_id:
            m = conn.execute("SELECT * FROM members WHERE id = ?", (b.member_id,)).fetchone()
            if not m:
                raise HTTPException(400, "Unknown member")
        else:
            name = " ".join(b.new_name.split())
            if len(name) < 3 or " " not in name:
                raise HTTPException(400, "Please enter your full name (first and last)")
            m = conn.execute("SELECT * FROM members WHERE name = ?", (name,)).fetchone()
            if not m:
                cur = conn.execute(
                    """INSERT INTO members(name, category, cox_status, needs_review, notes)
                       VALUES (?, 'Novice', '', 1, 'Added via the weekly sign-up form')""", (name,))
                m = conn.execute("SELECT * FROM members WHERE id = ?", (cur.lastrowid,)).fetchone()
                created = True
        mid = m["id"]
        if mode == "required" and not phone and not m["phone"]:
            if created:
                conn.execute("DELETE FROM members WHERE id = ?", (mid,))
            raise HTTPException(400, "Please add a phone number so coaches can reach you")

        # keep member profile up to date (phone numbers are stored encrypted)
        enc = privacy.encrypt(phone) if phone else ""
        conn.execute(
            """UPDATE members SET phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                   phone_updated_at = CASE WHEN ? != '' THEN datetime('now') ELSE phone_updated_at END,
                   college = ?, side = CASE WHEN ? != '' THEN ? ELSE side END,
                   squad = CASE WHEN ? != '' THEN ? ELSE squad END, active = 1 WHERE id = ?""",
            (enc, enc, enc, college, b.side if rows else "", b.side if rows else "", squad, squad, mid))

        existing = conn.execute("SELECT id FROM signups WHERE week_start = ? AND member_id = ?", (ws, mid)).fetchone()
        vals = (b.role, b.want_row if rows else 0, b.want_cox if coxes else 0, b.side if rows else "", squad,
                b.max_land if b.role != "bankrider" else 0, int(b.can_bankride or b.role == "bankrider"), college, b.comments.strip())
        if existing:
            sid = existing["id"]
            conn.execute(
                """UPDATE signups SET role=?, want_row=?, want_cox=?, side=?, squad=?, max_land=?, can_bankride=?,
                   college=?, comments=?, updated_at=datetime('now') WHERE id=?""", vals + (sid,))
            conn.execute("DELETE FROM signup_availability WHERE signup_id = ?", (sid,))
        else:
            sid = conn.execute(
                """INSERT INTO signups(role, want_row, want_cox, side, squad, max_land, can_bankride, college, comments,
                   week_start, member_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)""", vals + (ws, mid)).lastrowid
        conn.executemany("INSERT INTO signup_availability(signup_id, slot_id) VALUES (?, ?)",
                         [(sid, s) for s in slot_ids])
        return {"ok": True, "member_id": mid, "member_name": m["name"], "created": created,
                "updated": bool(existing)}


# ---------------------------------------------------------- committee -----
@router.get("/api/committee/signup/{week_start}")
def signup_committee(week_start: str, _: str = Depends(require_committee)):
    ws = _monday(week_start)
    with db.get_conn() as conn:
        w = _week_row(conn, ws)
        slots = _slots(conn, ws)
        avail = slot_availability(conn, ws)
        members = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM members")}
        responses = []
        for r in conn.execute("SELECT * FROM signups WHERE week_start = ? ORDER BY updated_at DESC", (ws,)):
            m = members.get(r["member_id"], {})
            responses.append({
                **dict(r), "can_bankride": bool(r["can_bankride"]),
                "name": m.get("name"), "has_phone": bool(m.get("phone")), "phone_masked": privacy.mask(m.get("phone", "")),
                "category": m.get("category"),
                # squad from this sign-up, or from their profile for sign-ups made before the question existed
                "squad": r["squad"] or (m.get("squad") if r["role"] in ("rower", "both") else ""),
                "cox_status": m.get("cox_status"), "needs_review": bool(m.get("needs_review")),
                "slot_ids": sorted(s for s, ms in avail.items() if r["member_id"] in ms),
            })
        # scheduled outings this week per member (to compare with their maximums)
        sched = week_counts(conn, ws)
        for resp in responses:
            resp["scheduled"] = sched.get(resp["member_id"], {"row": 0, "cox": 0, "land": 0})
        roles_by_member = {r["member_id"]: r for r in responses}
        for s in slots:
            ms = avail.get(s["id"], set())
            s["count"] = len(ms)
            rowers = [roles_by_member[x] for x in ms if roles_by_member.get(x, {}).get("role") in ("rower", "both")]
            s["rowers"] = len(rowers)
            s["rowers_open"] = sum(1 for r in rowers if r["squad"] == "open")
            s["rowers_women"] = sum(1 for r in rowers if r["squad"] == "women")
            s["rowers_unknown"] = s["rowers"] - s["rowers_open"] - s["rowers_women"]
            s["coxes"] = sum(1 for x in ms if roles_by_member.get(x, {}).get("role") in ("cox", "both"))
            s["bankriders"] = sum(1 for x in ms if roles_by_member.get(x, {}).get("can_bankride"))
        return {"week": {**w, "open": bool(w["open"])}, "slots": slots, "responses": responses,
                "roles": ROLES, "sides": SIDES, "squads": SQUADS, "colleges": COLLEGES, "slot_kinds": SLOT_KINDS}


class WeekSettingsIn(BaseModel):
    open: bool
    note: str = Field("", max_length=500)


@router.put("/api/committee/signup/{week_start}")
def signup_week_update(week_start: str, b: WeekSettingsIn, _: str = Depends(require_committee)):
    ws = _monday(week_start)
    with db.get_conn() as conn:
        conn.execute(
            """INSERT INTO signup_weeks(week_start, open, note) VALUES (?, ?, ?)
               ON CONFLICT(week_start) DO UPDATE SET open = excluded.open, note = excluded.note""",
            (ws, int(b.open), b.note.strip()))
        return {"ok": True}


class SlotIn(BaseModel):
    date: str
    time: str = Field("", max_length=20)
    end_time: str = Field("", max_length=20)
    kind: str = "water"
    location: str = Field("", max_length=80)
    note: str = Field("", max_length=200)
    dates: list[str] = Field([], max_length=7)  # create only: the same session on several days of one week


def _slot_validate(b: SlotIn) -> str:
    if b.kind not in SLOT_KINDS:
        raise HTTPException(400, "Type must be water, erg or tank")
    start, end = norm_time(b.time)
    if b.end_time.strip():
        end = norm_time(b.end_time)[0]
    if end and (to_minutes(start) is None or to_minutes(end) is None or to_minutes(end) <= to_minutes(start)):
        raise HTTPException(400, "The end time must be after the start time")
    b.time, b.end_time = start, end
    return _monday(b.date)


@router.post("/api/committee/signup/slots")
def slot_create(b: SlotIn, _: str = Depends(require_committee)):
    dates = sorted(set(b.dates or [b.date]))
    b.date = dates[0]
    ws = _slot_validate(b)
    for d in dates:
        try:
            date.fromisoformat(d)
        except ValueError:
            raise HTTPException(400, "Bad date")
        if _monday(d) != ws:
            raise HTTPException(400, "All days must be in the same week")
    with db.get_conn() as conn:
        ids = [conn.execute("INSERT INTO signup_slots(week_start, date, time, end_time, kind, location, note) VALUES (?,?,?,?,?,?,?)",
                            (ws, d, b.time, b.end_time, b.kind, b.location.strip(), b.note.strip())).lastrowid for d in dates]
        return {"id": ids[0], "ids": ids, "created": len(ids)}


@router.put("/api/committee/signup/slots/{slot_id}")
def slot_update(slot_id: int, b: SlotIn, _: str = Depends(require_committee)):
    ws = _slot_validate(b)
    with db.get_conn() as conn:
        conn.execute("UPDATE signup_slots SET week_start=?, date=?, time=?, end_time=?, kind=?, location=?, note=? WHERE id=?",
                     (ws, b.date, b.time, b.end_time, b.kind, b.location.strip(), b.note.strip(), slot_id))
        return {"ok": True}


@router.delete("/api/committee/signup/slots/{slot_id}")
def slot_delete(slot_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM signup_slots WHERE id = ?", (slot_id,))
        return {"ok": True}


class CopySlotsIn(BaseModel):
    source: str


@router.post("/api/committee/signup/{week_start}/copy-slots")
def slots_copy(week_start: str, b: CopySlotsIn, _: str = Depends(require_committee)):
    ws, src = _monday(week_start), _monday(b.source)
    if ws == src:
        raise HTTPException(400, "Source and target week are the same")
    delta = date.fromisoformat(ws) - date.fromisoformat(src)
    with db.get_conn() as conn:
        n = 0
        for s in _slots(conn, src):
            conn.execute("INSERT INTO signup_slots(week_start, date, time, end_time, kind, location, note) VALUES (?,?,?,?,?,?,?)",
                         (ws, (date.fromisoformat(s["date"]) + delta).isoformat(), s["time"], s["end_time"], s["kind"],
                          s["location"], s["note"]))
            n += 1
        return {"copied": n}


@router.delete("/api/committee/signup/responses/{signup_id}")
def response_delete(signup_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM signups WHERE id = ?", (signup_id,))
        return {"ok": True}


@router.get("/api/committee/signup/{week_start}/responses.csv")
def responses_csv(week_start: str, include_phone: bool = False, _: str = Depends(require_committee)):
    data = signup_committee(week_start)
    phones = {}
    if include_phone:
        with db.get_conn() as conn:
            phones = {r["id"]: privacy.decrypt(r["phone"]) or "" for r in conn.execute("SELECT id, phone FROM members")}
    slots = data["slots"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name"] + (["Phone"] if include_phone else []) + ["College", "Signing up as", "Max water outings", "Coxing outings wanted",
                "Squad", "Side", "Max land outings", "Can bankride", "Comments", "Submitted"]
               + [f"{SLOT_KINDS[s['kind']]} {s['date']} {s['time']}".strip() for s in slots])
    for r in data["responses"]:
        w.writerow([r["name"]] + ([phones.get(r["member_id"], "")] if include_phone else []) + [r["college"], ROLES.get(r["role"], r["role"]), r["want_row"] or "",
                    r["want_cox"] or "", SQUADS.get(r["squad"], ""), r["side"], r["max_land"] if r["role"] != "bankrider" else "", "Yes" if r["can_bankride"] else "No",
                    r["comments"], r["updated_at"]]
                   + ["Yes" if s["id"] in r["slot_ids"] else "" for s in slots])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=signups-{data['week']['week_start']}.csv"})
