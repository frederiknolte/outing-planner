"""Socials: club events (a pub trip, a formal, a bar night) listed on the schedule and in the calendar feeds.

A social is a date, time, place and note. Unlike an outing it has no seats, and it doesn't count towards
anyone's totals. Published socials show for every member; drafts only for the committee. Members can sign
themselves up (and off again) from the schedule; it's a plain list with no limit.

A social can also be a sports activity (kind "sport": a run, a hike, a swim). The note says what it is and where
and when to meet. It works the same way, except that it only goes in the calendar of members who signed up,
whereas every published social goes in everyone's calendar. Like socials, activities don't count as outings.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import require_committee, require_member
from .common import parse_date, parse_times, published_only, today
from .logic import maps_url, places_by_name

router = APIRouter()

KINDS = ("social", "sport")


def week_socials(conn, start: str, end: str, committee: bool) -> list[dict]:
    """Socials and sports activities between start and end (inclusive) for the schedule. Rowers only get published ones."""
    rows = conn.execute("SELECT * FROM socials WHERE date BETWEEN ? AND ?" + published_only(committee)
                        + " ORDER BY date, time, id", (start, end)).fetchall()
    places = places_by_name(conn) if rows else {}
    going: dict[int, list[dict]] = {}
    ids = [r["id"] for r in rows]
    if ids:
        marks = ",".join("?" * len(ids))
        for g in conn.execute(f"""SELECT s.social_id, m.id, m.name FROM social_signups s JOIN members m ON m.id = s.member_id
                                  WHERE s.social_id IN ({marks}) ORDER BY s.created_at, m.name""", ids):
            going.setdefault(g["social_id"], []).append({"id": g["id"], "name": g["name"]})
    now = today(conn).isoformat()
    return [{"id": r["id"], "kind": r["kind"], "title": r["title"], "date": r["date"], "time": r["time"], "end_time": r["end_time"],
             "location": r["location"], "maps_url": maps_url(places.get(r["location"].strip().lower())),
             "notes": r["notes"], "published": bool(r["published"]), "past": r["date"] < now,
             "going": going.get(r["id"], [])} for r in rows]


class SocialIn(BaseModel):
    kind: str = "social"
    title: str = Field(..., min_length=1, max_length=80)
    date: str
    time: str = Field("", max_length=20)
    end_time: str = Field("", max_length=20)
    location: str = Field("", max_length=80)
    notes: str = Field("", max_length=1000)
    published: Optional[bool] = None


def _fields(b: SocialIn) -> tuple:
    if b.kind not in KINDS:
        raise HTTPException(400, "Unknown kind")
    parse_date(b.date)
    title = b.title.strip()
    if not title:
        raise HTTPException(400, "Give it a name")
    start, end = parse_times(b.time, b.end_time, "22:00")
    return b.kind, title, b.date, start, end, b.location.strip(), b.notes.strip()


@router.post("/api/committee/socials")
def social_create(b: SocialIn, _: str = Depends(require_committee)):
    kind, title, d, start, end, loc, notes = _fields(b)
    with db.get_conn() as conn:
        cur = conn.execute("INSERT INTO socials(kind, title, date, time, end_time, location, notes, published) VALUES (?,?,?,?,?,?,?,?)",
                           (kind, title, d, start, end, loc, notes, int(bool(b.published))))
        return {"id": cur.lastrowid}


@router.put("/api/committee/socials/{sid}")
def social_update(sid: int, b: SocialIn, _: str = Depends(require_committee)):
    kind, title, d, start, end, loc, notes = _fields(b)
    with db.get_conn() as conn:
        if not conn.execute("SELECT 1 FROM socials WHERE id = ?", (sid,)).fetchone():
            raise HTTPException(404, "Not found")
        conn.execute("UPDATE socials SET kind=?, title=?, date=?, time=?, end_time=?, location=?, notes=? WHERE id=?",
                     (kind, title, d, start, end, loc, notes, sid))
        if b.published is not None:
            conn.execute("UPDATE socials SET published=? WHERE id=?", (int(b.published), sid))
        return {"id": sid}


@router.delete("/api/committee/socials/{sid}")
def social_delete(sid: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM socials WHERE id = ?", (sid,))
        return {"ok": True}


class JoinIn(BaseModel):
    member_id: int


def _open_event(conn, sid: int, role: str):
    """An event the caller can see (drafts are committee-only) that hasn't happened yet."""
    r = conn.execute("SELECT * FROM socials WHERE id = ?", (sid,)).fetchone()
    if not r or (not r["published"] and role != "committee"):
        raise HTTPException(404, "Event not found")
    if r["date"] < today(conn).isoformat():
        raise HTTPException(400, "This event is in the past")
    return r


@router.post("/api/socials/{sid}/join")
def activity_join(sid: int, b: JoinIn, role: str = Depends(require_member)):
    """A member signs themselves up to a published social or sports activity that hasn't happened yet."""
    with db.get_conn() as conn:
        _open_event(conn, sid, role)
        if not conn.execute("SELECT 1 FROM members WHERE id = ?", (b.member_id,)).fetchone():
            raise HTTPException(400, "Unknown member")
        conn.execute("INSERT OR IGNORE INTO social_signups(social_id, member_id) VALUES (?, ?)", (sid, b.member_id))
        return {"ok": True}


@router.post("/api/socials/{sid}/leave")
def activity_leave(sid: int, b: JoinIn, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        _open_event(conn, sid, role)
        conn.execute("DELETE FROM social_signups WHERE social_id = ? AND member_id = ?", (sid, b.member_id))
        return {"ok": True}
