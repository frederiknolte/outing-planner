"""Race sign-up.

Admins create races (title, date, term, city, expected time slot, who should
enter, race type, notes and source links). Members then mark themselves as
available, maybe, or not available for each race they're eligible for.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import require_admin, require_member
from .logic import TERMS, effective_today

router = APIRouter()

ENTRY = {"all": "Everyone", "novice": "Novices", "senior": "Seniors"}
STATUSES = {"yes": "Available", "maybe": "Maybe", "no": "Not available"}
MAX_LINKS = 10


class LinkIn(BaseModel):
    label: str = Field("", max_length=120)
    url: str = Field(..., max_length=1000)


class RaceIn(BaseModel):
    title: str = Field(..., max_length=200)
    date: str
    term: str = ""
    city: str = Field("", max_length=120)
    time_slot: str = Field("", max_length=120)
    entry: str = "all"
    race_type: str = Field("", max_length=200)
    notes: str = Field("", max_length=4000)
    open: bool = True
    links: list[LinkIn] = []


class ResponseIn(BaseModel):
    member_id: int
    status: str
    comment: str = Field("", max_length=500)


def _clean_url(u: str) -> str:
    u = u.strip()
    # Add https:// to bare addresses like "ourcs.co.uk", but leave any other scheme (e.g. javascript:) to be rejected.
    if u and not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d)", u):
        u = "https://" + u
    p = urlparse(u)
    # Only plain web links: blocks javascript:, data: etc. from being rendered as hrefs.
    if p.scheme not in ("http", "https") or not p.netloc:
        raise HTTPException(400, f"Not a valid web link: {u[:80]}")
    return u


def _validate(b: RaceIn) -> dict:
    title = b.title.strip()
    if not title:
        raise HTTPException(400, "Give the race a title")
    try:
        d = date.fromisoformat(b.date).isoformat()
    except ValueError:
        raise HTTPException(400, "Pick a date for the race")
    if b.term and b.term not in TERMS:
        raise HTTPException(400, "Unknown term")
    if b.entry not in ENTRY:
        raise HTTPException(400, "Choose who should enter")
    links = [l for l in b.links if l.url.strip()]
    if len(links) > MAX_LINKS:
        raise HTTPException(400, f"At most {MAX_LINKS} links")
    return {
        "title": title, "date": d, "term": b.term, "city": b.city.strip(), "time_slot": b.time_slot.strip(),
        "entry": b.entry, "race_type": b.race_type.strip(), "notes": b.notes.strip(), "open": int(b.open),
        "links": [(l.label.strip(), _clean_url(l.url)) for l in links],
    }


def _save_links(conn, race_id: int, links: list[tuple[str, str]]) -> None:
    conn.execute("DELETE FROM race_links WHERE race_id = ?", (race_id,))
    for i, (label, url) in enumerate(links):
        conn.execute("INSERT INTO race_links(race_id, position, label, url) VALUES (?, ?, ?, ?)",
                     (race_id, i, label, url))


def _eligible(entry: str, category: str) -> bool:
    return entry == "all" or entry == (category or "").lower()


@router.get("/api/races")
def races_list(me: Optional[int] = None, role: str = Depends(require_member)):
    admin = role == "admin"
    with db.get_conn() as conn:
        today = effective_today(db.get_settings(conn)).isoformat()
        races = [dict(r) for r in conn.execute("SELECT * FROM races ORDER BY date, id")]
        links, resp = {}, {}
        for r in conn.execute("SELECT * FROM race_links ORDER BY race_id, position"):
            links.setdefault(r["race_id"], []).append({"label": r["label"], "url": r["url"]})
        for r in conn.execute(
                """SELECT rr.race_id, rr.member_id, rr.status, rr.comment, rr.updated_at, m.name, m.category
                   FROM race_responses rr JOIN members m ON m.id = rr.member_id
                   ORDER BY m.name COLLATE NOCASE"""):
            resp.setdefault(r["race_id"], []).append(r)
        for race in races:
            rows = resp.get(race["id"], [])
            race["open"] = bool(race["open"])
            race["past"] = race["date"] < today
            race["links"] = links.get(race["id"], [])
            race["counts"] = {k: sum(1 for x in rows if x["status"] == k) for k in STATUSES}
            # Comments are admin-only (except your own, so the form can be prefilled).
            race["responses"] = [
                {"member_id": x["member_id"], "name": x["name"], "category": x["category"], "status": x["status"],
                 **({"comment": x["comment"], "updated_at": x["updated_at"]} if admin or x["member_id"] == me else {})}
                for x in rows]
        return {"races": races, "today": today, "terms": TERMS, "entry": ENTRY, "statuses": STATUSES}


@router.post("/api/admin/races")
def race_create(b: RaceIn, _: str = Depends(require_admin)):
    v = _validate(b)
    with db.get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO races(title, date, term, city, time_slot, entry, race_type, notes, open)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (v["title"], v["date"], v["term"], v["city"], v["time_slot"], v["entry"], v["race_type"], v["notes"], v["open"]))
        _save_links(conn, cur.lastrowid, v["links"])
        return {"id": cur.lastrowid}


@router.put("/api/admin/races/{race_id}")
def race_update(race_id: int, b: RaceIn, _: str = Depends(require_admin)):
    v = _validate(b)
    with db.get_conn() as conn:
        cur = conn.execute(
            """UPDATE races SET title=?, date=?, term=?, city=?, time_slot=?, entry=?, race_type=?, notes=?, open=?
               WHERE id=?""",
            (v["title"], v["date"], v["term"], v["city"], v["time_slot"], v["entry"], v["race_type"], v["notes"], v["open"], race_id))
        if not cur.rowcount:
            raise HTTPException(404, "Race not found")
        _save_links(conn, race_id, v["links"])
        return {"ok": True}


@router.delete("/api/admin/races/{race_id}")
def race_delete(race_id: int, _: str = Depends(require_admin)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM races WHERE id = ?", (race_id,))
        return {"ok": True}


def _check_can_respond(conn, race_id: int, member_id: int, admin: bool):
    race = conn.execute("SELECT * FROM races WHERE id = ?", (race_id,)).fetchone()
    if not race:
        raise HTTPException(404, "Race not found")
    m = conn.execute("SELECT id, category, active FROM members WHERE id = ?", (member_id,)).fetchone()
    if not m or not m["active"]:
        raise HTTPException(404, "Member not found")
    if not admin:
        today = effective_today(db.get_settings(conn)).isoformat()
        if race["date"] < today:
            raise HTTPException(400, "This race has already happened")
        if not race["open"]:
            raise HTTPException(400, "Sign-up for this race is closed")
        if not _eligible(race["entry"], m["category"]):
            raise HTTPException(400, f"This race is for {ENTRY[race['entry']].lower()} only")
    return race


@router.put("/api/races/{race_id}/response")
def response_set(race_id: int, b: ResponseIn, role: str = Depends(require_member)):
    if b.status not in STATUSES:
        raise HTTPException(400, "Choose available, maybe or not available")
    with db.get_conn() as conn:
        _check_can_respond(conn, race_id, b.member_id, role == "admin")
        conn.execute(
            """INSERT INTO race_responses(race_id, member_id, status, comment) VALUES (?, ?, ?, ?)
               ON CONFLICT(race_id, member_id) DO UPDATE SET status = excluded.status, comment = excluded.comment,
                 updated_at = datetime('now')""",
            (race_id, b.member_id, b.status, b.comment.strip()))
        return {"ok": True}


@router.delete("/api/races/{race_id}/response/{member_id}")
def response_clear(race_id: int, member_id: int, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        _check_can_respond(conn, race_id, member_id, role == "admin")
        conn.execute("DELETE FROM race_responses WHERE race_id = ? AND member_id = ?", (race_id, member_id))
        return {"ok": True}
