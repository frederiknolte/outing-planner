"""Race sign-up.

The committee creates races (title, date, term, city, expected time slot, who should
enter, which squad, race type, notes and source links). Members then say whether
they're available, maybe or not available, plus whether they'd row, cox or both,
and (if they'd row) their squad (Open / Women's) and side. Squad and side are
saved back to the member's profile.

Eligibility (race_problems) is checked on the server: a novice race is for novices,
a senior race for seniors (but senior coxes can cox novice races), and an Open or
Women's race needs a rower from that squad. Coxes have no squad and aren't held to
the squad rule (anyone can cox either squad's crew). Rowers can't submit an ineligible
response; the committee is warned and can override.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import require_committee, require_member
from .logic import TERMS, effective_today
from .signup import SIDES, SQUADS

router = APIRouter()

ENTRY = {"all": "Everyone", "novice": "Novices", "senior": "Seniors"}
RACE_SQUADS = {"any": "Any squad", **SQUADS}
STATUSES = {"yes": "Available", "maybe": "Maybe", "no": "Not available"}
ROLES = {"rower": "Rower", "cox": "Cox", "both": "Rower or cox"}
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
    squad: str = "any"
    race_type: str = Field("", max_length=200)
    notes: str = Field("", max_length=4000)
    open: bool = True
    links: list[LinkIn] = []


class ResponseIn(BaseModel):
    member_id: int
    status: str
    squad: str = ""
    role: str = ""
    side: str = ""
    comment: str = Field("", max_length=500)
    override: bool = False     # committee only: save even if the member isn't eligible


class CheckIn(BaseModel):
    member_id: int
    status: str = "yes"
    squad: str = ""
    role: str = "rower"


def race_problems(race, category: str, squad: str, role: str, status: str) -> list[str]:
    """Why this member can't enter this race (empty list = eligible). Saying "not available" is always fine.

    Coxes aren't held to the squad rule, and senior coxes can cox novice races. When
    coxing would fix a problem for someone who'd row, the message says so.
    """
    if status == "no":
        return []
    out = []
    coxing = role == "cox"
    entry = race["entry"]
    cat = (category or "").lower()
    if entry != "all" and entry != cat and not (coxing and entry == "novice" and cat == "senior"):
        out.append(f"This race is for {ENTRY[entry].lower()}, and they're {'a ' + cat if cat else 'not set as novice or senior'}"
                   + (" (they could still cox)" if entry == "novice" and cat == "senior" else ""))
    rsq = race["squad"] or "any"
    if not coxing and rsq != "any" and squad != rsq:
        out.append(f"This race is for the {SQUADS[rsq]} squad, and they're {'in the ' + SQUADS[squad] + ' squad' if squad in SQUADS else 'not in a squad yet'}"
                   " (they could still cox)")
    return out


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
    if b.squad not in RACE_SQUADS:
        raise HTTPException(400, "Choose which squad the race is for")
    links = [l for l in b.links if l.url.strip()]
    if len(links) > MAX_LINKS:
        raise HTTPException(400, f"At most {MAX_LINKS} links")
    return {
        "title": title, "date": d, "term": b.term, "city": b.city.strip(), "time_slot": b.time_slot.strip(),
        "entry": b.entry, "squad": b.squad, "race_type": b.race_type.strip(), "notes": b.notes.strip(), "open": int(b.open),
        "links": [(l.label.strip(), _clean_url(l.url)) for l in links],
    }


def _save_links(conn, race_id: int, links: list[tuple[str, str]]) -> None:
    conn.execute("DELETE FROM race_links WHERE race_id = ?", (race_id,))
    for i, (label, url) in enumerate(links):
        conn.execute("INSERT INTO race_links(race_id, position, label, url) VALUES (?, ?, ?, ?)",
                     (race_id, i, label, url))



@router.get("/api/races")
def races_list(me: Optional[int] = None, role: str = Depends(require_member)):
    committee = role == "committee"
    with db.get_conn() as conn:
        today = effective_today(db.get_settings(conn)).isoformat()
        races = [dict(r) for r in conn.execute("SELECT * FROM races ORDER BY date, id")]
        links, resp = {}, {}
        for r in conn.execute("SELECT * FROM race_links ORDER BY race_id, position"):
            links.setdefault(r["race_id"], []).append({"label": r["label"], "url": r["url"]})
        for r in conn.execute(
                """SELECT rr.race_id, rr.member_id, rr.status, rr.squad, rr.role, rr.side, rr.comment, rr.updated_at,
                          m.name, m.category
                   FROM race_responses rr JOIN members m ON m.id = rr.member_id
                   ORDER BY m.name COLLATE NOCASE"""):
            resp.setdefault(r["race_id"], []).append(r)
        mine = conn.execute("SELECT category, squad, side FROM members WHERE id = ?", (me,)).fetchone() if me else None
        for race in races:
            rows = resp.get(race["id"], [])
            race["squad"] = race["squad"] or "any"
            # Would the selected member be eligible to row, going by their profile? (shown on the card)
            race["me_problems"] = race_problems(race, mine["category"], mine["squad"], "rower", "yes") if mine else []
            race["open"] = bool(race["open"])
            race["past"] = race["date"] < today
            race["links"] = links.get(race["id"], [])
            race["counts"] = {k: sum(1 for x in rows if x["status"] == k) for k in STATUSES}
            # Comments are committee-only (except your own, so the form can be prefilled).
            race["responses"] = [
                {"member_id": x["member_id"], "name": x["name"], "category": x["category"], "status": x["status"],
                 "squad": x["squad"], "role": x["role"], "side": x["side"],
                 # committee: why this response breaks the entry rules (it was saved with an override)
                 **({"problems": race_problems(race, x["category"], x["squad"], x["role"], x["status"])} if committee else {}),
                 **({"comment": x["comment"], "updated_at": x["updated_at"]} if committee or x["member_id"] == me else {})}
                for x in rows]
        return {"races": races, "today": today, "terms": TERMS, "entry": ENTRY, "statuses": STATUSES,
                "squads": SQUADS, "race_squads": RACE_SQUADS, "roles": ROLES, "sides": SIDES,
                "me": {"squad": mine["squad"], "side": mine["side"], "category": mine["category"]} if mine else None}


@router.post("/api/committee/races")
def race_create(b: RaceIn, _: str = Depends(require_committee)):
    v = _validate(b)
    with db.get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO races(title, date, term, city, time_slot, entry, squad, race_type, notes, open)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (v["title"], v["date"], v["term"], v["city"], v["time_slot"], v["entry"], v["squad"], v["race_type"], v["notes"], v["open"]))
        _save_links(conn, cur.lastrowid, v["links"])
        return {"id": cur.lastrowid}


@router.put("/api/committee/races/{race_id}")
def race_update(race_id: int, b: RaceIn, _: str = Depends(require_committee)):
    v = _validate(b)
    with db.get_conn() as conn:
        cur = conn.execute(
            """UPDATE races SET title=?, date=?, term=?, city=?, time_slot=?, entry=?, squad=?, race_type=?, notes=?, open=?
               WHERE id=?""",
            (v["title"], v["date"], v["term"], v["city"], v["time_slot"], v["entry"], v["squad"], v["race_type"], v["notes"], v["open"], race_id))
        if not cur.rowcount:
            raise HTTPException(404, "Race not found")
        _save_links(conn, race_id, v["links"])
        return {"ok": True}


@router.delete("/api/committee/races/{race_id}")
def race_delete(race_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM races WHERE id = ?", (race_id,))
        return {"ok": True}


def _check_can_respond(conn, race_id: int, member_id: int, committee: bool):
    race = conn.execute("SELECT * FROM races WHERE id = ?", (race_id,)).fetchone()
    if not race:
        raise HTTPException(404, "Race not found")
    m = conn.execute("SELECT id, category, squad, active FROM members WHERE id = ?", (member_id,)).fetchone()
    if not m or not m["active"]:
        raise HTTPException(404, "Member not found")
    if not committee:
        today = effective_today(db.get_settings(conn)).isoformat()
        if race["date"] < today:
            raise HTTPException(400, "This race has already happened")
        if not race["open"]:
            raise HTTPException(400, "Sign-up for this race is closed")
    return race, m


def _clean_response(b: ResponseIn) -> tuple[str, str, str]:
    """(squad, role, side), validated. Not available needs none of them."""
    if b.status not in STATUSES:
        raise HTTPException(400, "Choose available, maybe or not available")
    if b.status == "no":
        return (b.squad if b.squad in SQUADS else ""), "", ""
    role = b.role
    if role not in ROLES:
        raise HTTPException(400, "Choose whether you'd row, cox or both")
    if role == "cox":                       # coxes cox either squad's crew
        return "", role, ""
    if b.squad not in SQUADS:
        raise HTTPException(400, "Choose your squad (Open or Women's)")
    if b.side not in SIDES:
        raise HTTPException(400, "Choose a side preference")
    return b.squad, role, b.side


@router.post("/api/races/{race_id}/check")
def response_check(race_id: int, b: CheckIn, _: str = Depends(require_member)):
    """Eligibility problems for a possible response (used by the form as you fill it in)."""
    with db.get_conn() as conn:
        race = conn.execute("SELECT * FROM races WHERE id = ?", (race_id,)).fetchone()
        m = conn.execute("SELECT category, squad, side FROM members WHERE id = ?", (b.member_id,)).fetchone()
        if not race or not m:
            raise HTTPException(404, "Not found")
        return {"problems": race_problems(race, m["category"], b.squad or m["squad"], b.role, b.status),
                "profile": {"squad": m["squad"], "side": m["side"], "category": m["category"]}}


@router.put("/api/races/{race_id}/response")
def response_set(race_id: int, b: ResponseIn, role: str = Depends(require_member)):
    committee = role == "committee"
    squad, rrole, side = _clean_response(b)
    with db.get_conn() as conn:
        race, m = _check_can_respond(conn, race_id, b.member_id, committee)
        problems = race_problems(race, m["category"], squad, rrole, b.status)
        if problems and not (committee and b.override):
            if committee:
                raise HTTPException(409, {"problems": problems})
            raise HTTPException(400, problems[0].replace("they're", "you're").replace("they could", "you could"))
        conn.execute(
            """INSERT INTO race_responses(race_id, member_id, status, squad, role, side, comment) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(race_id, member_id) DO UPDATE SET status = excluded.status, squad = excluded.squad,
                 role = excluded.role, side = excluded.side, comment = excluded.comment, updated_at = datetime('now')""",
            (race_id, b.member_id, b.status, squad, rrole, side, b.comment.strip()))
        # Remember squad and side on the profile, like the weekly sign-up does.
        conn.execute("""UPDATE members SET squad = CASE WHEN ? != '' THEN ? ELSE squad END,
                          side = CASE WHEN ? != '' THEN ? ELSE side END WHERE id = ?""",
                     (squad, squad, side, side, b.member_id))
        return {"ok": True, "problems": problems}


@router.delete("/api/races/{race_id}/response/{member_id}")
def response_clear(race_id: int, member_id: int, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        _check_can_respond(conn, race_id, member_id, role == "committee")
        conn.execute("DELETE FROM race_responses WHERE race_id = ? AND member_id = ?", (race_id, member_id))
        return {"ok": True}
