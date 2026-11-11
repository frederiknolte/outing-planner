"""Socials: club events (a pub trip, a formal, a bar night) listed on the schedule and in the calendar feeds.

A social is only a date, time, place and note. Unlike an outing it has no seats and no sign-ups, and it
doesn't count towards anyone's totals. Published socials show for every member; drafts only for the committee.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import require_committee
from .logic import maps_url
from .timeutil import normalize, to_minutes

router = APIRouter()


def week_socials(conn, start: str, end: str, committee: bool) -> list[dict]:
    """Socials between start and end (inclusive) for the schedule. Rowers only get published ones."""
    rows = conn.execute("SELECT * FROM socials WHERE date BETWEEN ? AND ?" + ("" if committee else " AND published = 1")
                        + " ORDER BY date, time, id", (start, end)).fetchall()
    places = {r["name"].lower(): dict(r) for r in conn.execute("SELECT * FROM places")} if rows else {}
    return [{"id": r["id"], "title": r["title"], "date": r["date"], "time": r["time"], "end_time": r["end_time"],
             "location": r["location"], "maps_url": maps_url(places.get(r["location"].strip().lower())),
             "notes": r["notes"], "published": bool(r["published"])} for r in rows]


class SocialIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    date: str
    time: str = Field("", max_length=20)
    end_time: str = Field("", max_length=20)
    location: str = Field("", max_length=80)
    notes: str = Field("", max_length=500)
    published: Optional[bool] = None


def _fields(b: SocialIn) -> tuple:
    from datetime import date
    try:
        date.fromisoformat(b.date)
    except ValueError:
        raise HTTPException(400, "Bad date")
    title = b.title.strip()
    if not title:
        raise HTTPException(400, "Give the social a name")
    start, end = normalize(b.time)
    if b.end_time.strip():
        end = normalize(b.end_time)[0]
        if to_minutes(end) is None:
            raise HTTPException(400, "End time not recognised. Use e.g. 22:00")
    if to_minutes(start) is None:
        end = ""
    elif end and (to_minutes(end) is None or to_minutes(end) <= to_minutes(start)):
        raise HTTPException(400, "The end time must be after the start time")
    return title, b.date, start, end, b.location.strip(), b.notes.strip()


@router.post("/api/committee/socials")
def social_create(b: SocialIn, _: str = Depends(require_committee)):
    title, d, start, end, loc, notes = _fields(b)
    with db.get_conn() as conn:
        cur = conn.execute("INSERT INTO socials(title, date, time, end_time, location, notes, published) VALUES (?,?,?,?,?,?,?)",
                           (title, d, start, end, loc, notes, int(bool(b.published))))
        return {"id": cur.lastrowid}


@router.put("/api/committee/socials/{sid}")
def social_update(sid: int, b: SocialIn, _: str = Depends(require_committee)):
    title, d, start, end, loc, notes = _fields(b)
    with db.get_conn() as conn:
        if not conn.execute("SELECT 1 FROM socials WHERE id = ?", (sid,)).fetchone():
            raise HTTPException(404, "Social not found")
        conn.execute("UPDATE socials SET title=?, date=?, time=?, end_time=?, location=?, notes=? WHERE id=?",
                     (title, d, start, end, loc, notes, sid))
        if b.published is not None:
            conn.execute("UPDATE socials SET published=? WHERE id=?", (int(b.published), sid))
        return {"id": sid}


@router.delete("/api/committee/socials/{sid}")
def social_delete(sid: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM socials WHERE id = ?", (sid,))
        return {"ok": True}
