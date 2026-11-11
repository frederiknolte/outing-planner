"""Subs and open land sessions: rowers asking for a sub, taking someone's seat, and joining or leaving land sessions."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import crewlog, db, push
from .auth import require_member
from .boats import boats_by_id
from .common import (busy_at, cancel_open_subs, problems_error, require_upcoming, resolve_sub,
                     visible_outing)
from .logic import Rules, is_small_boat, seat_label

router = APIRouter()


# ------------------------------------------------------------ candidates ----
def candidates(conn, rules: Rules, outing_id: int, seat: int, member_ids=None) -> dict:
    """member id (as text) -> {ok, problems, note}: could they take this seat? Everyone, or just member_ids."""
    o = conn.execute("SELECT * FROM outings WHERE id = ?", (outing_id,)).fetchone()
    inside = {r[0] for r in conn.execute("SELECT member_id FROM assignments WHERE outing_id = ?", (outing_id,))}
    busy = busy_at(conn, o, outing_id)
    d, key = date.fromisoformat(o["date"]), (o["date"], o["time"], o["id"])
    out = {}
    for mid in (member_ids if member_ids is not None else rules.members):
        m = rules.members[mid]
        elig = rules.check(mid, o["kind"], d, key, small_boat=is_small_boat(o["kind"], o["capacity"], bool(o["coxed"])))
        problems = list(elig["reasons"])
        if mid in inside:
            problems.append("Already in this outing")
        elif mid in busy:
            problems.append("Booked in another outing at this time")
        if o["kind"] == "water" and seat == 0 and not m["cox_status"]:
            problems.append("Not a cox")
        out[str(mid)] = {"ok": not problems, "problems": problems, "note": elig["note"]}
    return out


def _require_candidate(conn, rules: Rules, member_id: int, outing_id: int, seat: int, what: str) -> None:
    """400 unless `member_id` is a known member who can take this seat ("Can't <what>: ...")."""
    if member_id not in rules.members:
        raise HTTPException(400, "Unknown member")
    problems_error(f"Can't {what}", candidates(conn, rules, outing_id, seat, [member_id])[str(member_id)])


@router.get("/api/subs/{sub_id}/candidates")
def sub_candidates(sub_id: int, role: str = Depends(require_member)):
    """Who could take this seat, with eligibility — used to pre-warn people volunteering."""
    with db.get_conn() as conn:
        r = conn.execute("SELECT outing_id, seat FROM sub_requests WHERE id = ?", (sub_id,)).fetchone()
        if not r:
            raise HTTPException(404, "Not found")
        return candidates(conn, Rules(conn), r["outing_id"], r["seat"])


@router.get("/api/outings/{oid}/sub-candidates")
def seat_sub_candidates(oid: int, member_id: int, role: str = Depends(require_member)):
    """Who could take this member's seat — used when a rower picks their own sub."""
    with db.get_conn() as conn:
        visible_outing(conn, oid, role)
        a = conn.execute("SELECT seat FROM assignments WHERE outing_id=? AND member_id=?", (oid, member_id)).fetchone()
        if not a:
            raise HTTPException(400, "That person isn't in this outing")
        return candidates(conn, Rules(conn), oid, a["seat"])


# --------------------------------------------------------------- the board ----
class SubRequestIn(BaseModel):
    outing_id: int
    member_id: int
    reason: str = Field("", max_length=300)
    # Set when the rower already found a sub themselves (e.g. offline): the seat is handed
    # straight to them instead of being posted to the sub board.
    sub_id: Optional[int] = None


class SubFillIn(BaseModel):
    member_id: int
    by: Optional[int] = None   # the rower using the app (to skip telling people what they did themselves)


class SubCancelIn(BaseModel):
    member_id: Optional[int] = None


def _sub_rows(conn, rules: Rules, where: str, params: tuple) -> list[dict]:
    rows = [dict(r) for r in conn.execute(
        f"""SELECT s.*, o.kind, o.date, o.time, o.end_time, o.title, o.location, o.capacity, o.coxed, o.boat_id
            FROM sub_requests s JOIN outings o ON o.id = s.outing_id WHERE {where}
            ORDER BY o.date, o.time, s.id""", params)]
    boats = boats_by_id(conn)
    out = []
    for r in rows:
        req = rules.members.get(r["requester_id"], {})
        sub = rules.members.get(r["sub_id"], {}) if r["sub_id"] else {}
        boat = boats.get(r["boat_id"])
        out.append({
            "id": r["id"], "status": r["status"], "reason": r["reason"], "created_at": r["created_at"],
            "resolved_at": r["resolved_at"], "seat": r["seat"],
            "seat_label": seat_label(r["seat"], r["capacity"], r["kind"]),
            "requester": {"id": r["requester_id"], "name": req.get("name")},
            "sub": {"id": r["sub_id"], "name": sub.get("name")} if r["sub_id"] else None,
            "outing": {"id": r["outing_id"], "kind": r["kind"], "date": r["date"], "time": r["time"], "end_time": r["end_time"],
                       "title": r["title"], "location": r["location"],
                       "boat": boat["name"] if boat else None},
        })
    return out


@router.get("/api/subs")
def list_subs(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        open_ = _sub_rows(conn, rules, "s.status = 'open' AND o.date >= ? AND o.published = 1", (rules.today.isoformat(),))
        recent = _sub_rows(conn, rules, "s.status = 'filled' AND o.date >= ?", ((rules.today - timedelta(days=7)).isoformat(),))
        return {"open": open_, "recent": recent[-30:]}


@router.post("/api/subs")
def request_sub(body: SubRequestIn, request: Request, role: str = Depends(require_member)):
    msgs: list = []
    oid, reason = body.outing_id, body.reason.strip()
    with db.get_conn() as conn:
        rules = Rules(conn)
        visible_outing(conn, oid, role, upcoming=True)
        a = conn.execute("SELECT * FROM assignments WHERE outing_id=? AND member_id=?", (oid, body.member_id)).fetchone()
        if not a:
            raise HTTPException(400, "That person isn't in this outing")
        if conn.execute("SELECT 1 FROM sub_requests WHERE outing_id=? AND seat=? AND status='open'", (oid, a["seat"])).fetchone():
            raise HTTPException(400, "A sub has already been requested for this seat")
        who = crewlog.actor(request, conn, body.member_id)
        if body.sub_id is not None:
            if body.sub_id not in rules.members:
                raise HTTPException(400, "Unknown member")
            if body.sub_id == body.member_id:
                raise HTTPException(400, "You can't sub for yourself")
            _require_candidate(conn, rules, body.sub_id, oid, a["seat"], "sub")
            before = push.snapshot(conn, ids=[oid])
            crew_before = crewlog.state(conn, oid)
            conn.execute("UPDATE assignments SET member_id=? WHERE outing_id=? AND seat=? AND member_id=?",
                         (body.sub_id, oid, a["seat"], body.member_id))
            sr_id = conn.execute("""INSERT INTO sub_requests(outing_id, seat, requester_id, reason, status, sub_id, resolved_at)
                                    VALUES (?, ?, ?, ?, 'filled', ?, datetime('now'))""",
                                 (oid, a["seat"], body.member_id, reason, body.sub_id)).lastrowid
            crewlog.record(conn, oid, crew_before, who, "sub_handover", sr_id, reason)
            msgs = push.crew_changes(conn, before, actor=body.member_id)
        else:
            sr_id = conn.execute("INSERT INTO sub_requests(outing_id, seat, requester_id, reason) VALUES (?, ?, ?, ?)",
                                 (oid, a["seat"], body.member_id, reason)).lastrowid
            crewlog.sub_event(conn, oid, "sub_request", sr_id, who, note=reason)
    push.dispatch(msgs)
    return {"ok": True}


def _open_request(conn, sub_id: int):
    s = conn.execute("SELECT * FROM sub_requests WHERE id = ?", (sub_id,)).fetchone()
    if not s or s["status"] != "open":
        raise HTTPException(400, "This sub request is no longer open")
    return s


@router.post("/api/subs/{sub_id}/fill")
def fill_sub(sub_id: int, body: SubFillIn, request: Request, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        s = _open_request(conn, sub_id)
        oid = s["outing_id"]
        if body.member_id not in rules.members:
            raise HTTPException(400, "Unknown member")
        if body.member_id == s["requester_id"]:
            raise HTTPException(400, "You can't sub for yourself — cancel the request instead")
        if conn.execute("SELECT cancelled FROM outings WHERE id = ?", (oid,)).fetchone()["cancelled"]:
            raise HTTPException(400, "This outing has been cancelled")
        _require_candidate(conn, rules, body.member_id, oid, s["seat"], "sub")
        before = push.snapshot(conn, ids=[oid])
        crew_before = crewlog.state(conn, oid)
        cur = conn.execute("UPDATE assignments SET member_id=? WHERE outing_id=? AND seat=? AND member_id=?",
                           (body.member_id, oid, s["seat"], s["requester_id"]))
        if cur.rowcount != 1:
            raise HTTPException(409, "The seat has changed — refresh and try again")
        resolve_sub(conn, sub_id, body.member_id)
        by = body.by if body.by is not None else (None if role == "committee" else body.member_id)
        crewlog.record(conn, oid, crew_before, crewlog.actor(request, conn, by), "sub_fill", sub_id)
        msgs = push.crew_changes(conn, before, actor=by)
        if by != s["requester_id"]:
            msgs += push.sub_filled(conn, oid, s["requester_id"], body.member_id)
    push.dispatch(msgs)
    return {"ok": True}


@router.post("/api/subs/{sub_id}/cancel")
def cancel_sub(sub_id: int, body: SubCancelIn, request: Request, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        s = _open_request(conn, sub_id)
        if role != "committee" and body.member_id != s["requester_id"]:
            raise HTTPException(403, "Only the person who asked (or the committee) can cancel this")
        resolve_sub(conn, sub_id)
        crewlog.sub_event(conn, s["outing_id"], "sub_cancel", sub_id, crewlog.actor(request, conn, body.member_id))
        return {"ok": True}


# ------------------------------------------------- open land sessions ----
class JoinIn(BaseModel):
    member_id: int


def _land_outing(conn, oid: int, role: str):
    o = visible_outing(conn, oid, role, "Session")
    if o["kind"] != "land":
        raise HTTPException(400, "Only land sessions are open to join. Water crews are picked by the coaches")
    require_upcoming(conn, o, "Session")
    return o


@router.post("/api/outings/{oid}/join")
def outing_join(oid: int, b: JoinIn, request: Request, role: str = Depends(require_member)):
    """A rower takes a free spot in a land session."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        o = _land_outing(conn, oid, role)
        _require_candidate(conn, rules, b.member_id, oid, 1, "join")
        taken = {r["seat"] for r in conn.execute("SELECT seat FROM assignments WHERE outing_id = ?", (oid,))}
        free = [s for s in range(1, o["capacity"] + 1) if s not in taken]
        if not free:
            raise HTTPException(400, "Sorry, this session is full")
        crew_before = crewlog.state(conn, oid)
        try:
            conn.execute("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?, ?, ?)", (oid, free[0], b.member_id))
        except db.sqlite3.IntegrityError:
            raise HTTPException(409, "Someone just took that spot. Please try again")
        crewlog.record(conn, oid, crew_before, crewlog.actor(request, conn, b.member_id), "join")
        return {"ok": True}


@router.post("/api/outings/{oid}/leave")
def outing_leave(oid: int, b: JoinIn, request: Request, role: str = Depends(require_member)):
    """A rower gives up their spot in a land session (no sub needed; the spot just reopens)."""
    with db.get_conn() as conn:
        _land_outing(conn, oid, role)
        a = conn.execute("SELECT seat FROM assignments WHERE outing_id = ? AND member_id = ?", (oid, b.member_id)).fetchone()
        if not a:
            raise HTTPException(400, "You're not in this session")
        crew_before = crewlog.state(conn, oid)
        conn.execute("DELETE FROM assignments WHERE outing_id = ? AND member_id = ?", (oid, b.member_id))
        cancel_open_subs(conn, oid, a["seat"])
        crewlog.compact_land(conn, oid)   # everyone below moves up the list
        crewlog.record(conn, oid, crew_before, crewlog.actor(request, conn, b.member_id), "leave")
        return {"ok": True}
