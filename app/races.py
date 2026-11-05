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

Crews: from the responses the committee forms crews (name, boat type, who sits where).
They stay a draft only the committee sees until the crews are published; publishing
notifies everyone whose seat is new or changed.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, push
from .auth import require_committee, require_member
from .logic import BOAT_TYPES, TERMS, TZ, effective_today, seat_label
from .signup import SIDES, SQUADS

router = APIRouter()

ENTRY = {"all": "Everyone", "novice": "Novices", "senior": "Seniors"}
RACE_SQUADS = {"any": "Any squad", **SQUADS}
STATUSES = {"yes": "Available", "maybe": "Maybe", "no": "Not available"}
ROLES = {"rower": "Rower", "cox": "Cox", "both": "Rower or cox"}
MAX_LINKS = 10
MAX_CREWS = 20


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
    opens_at: str = ""          # entries open, "YYYY-MM-DDTHH:MM" (local time) or ""
    closes_at: str = ""         # entries close, same format
    scratch_date: str = ""      # scratch (withdraw) deadline, YYYY-MM-DD or YYYY-MM-DDTHH:MM, or ""
    links: list[LinkIn] = []


class ResponseIn(BaseModel):
    member_id: int
    status: str
    squad: str = ""
    role: str = ""
    side: str = ""
    comment: str = Field("", max_length=500)
    override: bool = False     # committee only: save even if the member isn't eligible


class CrewIn(BaseModel):
    name: str = Field("", max_length=60)
    boat_type: str = "8+"
    notes: str = Field("", max_length=500)
    seats: dict[int, int] = {}          # seat (0 = cox) -> member id


class CrewsIn(BaseModel):
    crews: list[CrewIn] = []
    publish: bool = False


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


def _dt(text: str, what: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text).strftime("%Y-%m-%dT%H:%M")
    except ValueError:
        raise HTTPException(400, f"Not a valid date and time for {what}")


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
    opens_at, closes_at = _dt(b.opens_at, "entries opening"), _dt(b.closes_at, "entries closing")
    if opens_at and closes_at and closes_at <= opens_at:
        raise HTTPException(400, "Entries must close after they open")
    # Scratch deadline: a day, optionally with a time ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM").
    scratch = b.scratch_date.strip()
    if "T" in scratch:
        scratch = _dt(scratch, "the scratch deadline")
    elif scratch:
        try:
            scratch = date.fromisoformat(scratch).isoformat()
        except ValueError:
            raise HTTPException(400, "Not a valid scratch date")
    links = [l for l in b.links if l.url.strip()]
    if len(links) > MAX_LINKS:
        raise HTTPException(400, f"At most {MAX_LINKS} links")
    return {
        "title": title, "date": d, "term": b.term, "city": b.city.strip(), "time_slot": b.time_slot.strip(),
        "entry": b.entry, "squad": b.squad, "race_type": b.race_type.strip(), "notes": b.notes.strip(), "open": int(b.open),
        "opens_at": opens_at, "closes_at": closes_at, "scratch_date": scratch,
        "links": [(l.label.strip(), _clean_url(l.url)) for l in links],
    }


def _save_links(conn, race_id: int, links: list[tuple[str, str]]) -> None:
    conn.execute("DELETE FROM race_links WHERE race_id = ?", (race_id,))
    for i, (label, url) in enumerate(links):
        conn.execute("INSERT INTO race_links(race_id, position, label, url) VALUES (?, ?, ?, ?)",
                     (race_id, i, label, url))



def _load_crews(conn, race_ids=None) -> dict[int, list[dict]]:
    """race id -> crews, each with its seats (cox first, then stroke down to bow)."""
    where = f"WHERE c.race_id IN ({','.join('?' * len(race_ids))})" if race_ids is not None else ""
    crews, by_id = {}, {}
    for c in conn.execute(f"SELECT c.* FROM race_crews c {where} ORDER BY c.race_id, c.position, c.id", list(race_ids or [])):
        crew = {"id": c["id"], "name": c["name"], "boat_type": c["boat_type"], "notes": c["notes"], "seats": []}
        crews.setdefault(c["race_id"], []).append(crew)
        by_id[c["id"]] = crew
    if by_id:
        for s in conn.execute(
                f"""SELECT s.crew_id, s.seat, s.member_id, m.name FROM race_crew_seats s JOIN members m ON m.id = s.member_id
                    WHERE s.crew_id IN ({','.join('?' * len(by_id))}) ORDER BY s.crew_id, s.seat""", list(by_id)):
            crew = by_id[s["crew_id"]]
            crew["seats"].append({"seat": s["seat"], "label": seat_label(s["seat"], BOAT_TYPES.get(crew["boat_type"], (8, 1))[0], "water"),
                                  "member_id": s["member_id"], "name": s["name"]})
        for crew in by_id.values():
            crew["seats"].sort(key=lambda x: (x["seat"] != 0, -x["seat"]))
    return crews


def week_races(conn, start: str, end: str, committee: bool) -> list[dict]:
    """Races between start and end (inclusive) that have crews, for the schedule. Rowers only get published crews.
    Each crew lists every seat, empty ones with member_id None (they need a sub)."""
    rows = conn.execute("SELECT id, title, date, city, time_slot, crews_published FROM races WHERE date BETWEEN ? AND ?"
                        + ("" if committee else " AND crews_published = 1") + " ORDER BY date, id", (start, end)).fetchall()
    crews = _load_crews(conn, [r["id"] for r in rows]) if rows else {}
    out = []
    for r in rows:
        if not crews.get(r["id"]):
            continue
        full = []
        for c in crews[r["id"]]:
            rowers, coxed = BOAT_TYPES.get(c["boat_type"], (8, 1))
            by = {x["seat"]: x for x in c["seats"]}
            seats = ([0] if coxed else []) + list(range(rowers, 0, -1))
            full.append({**c, "seats": [by.get(n) or {"seat": n, "label": seat_label(n, rowers, "water"), "member_id": None, "name": ""}
                                        for n in seats]})
        out.append({"id": r["id"], "title": r["title"], "date": r["date"], "city": r["city"], "time_slot": r["time_slot"],
                    "published": bool(r["crews_published"]), "crews": full})
    return out


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
        crews = _load_crews(conn)
        for race in races:
            rows = resp.get(race["id"], [])
            race["squad"] = race["squad"] or "any"
            # Would the selected member be eligible to row, going by their profile? (shown on the card)
            race["me_problems"] = race_problems(race, mine["category"], mine["squad"], "rower", "yes") if mine else []
            race["open"] = bool(race["open"])
            race["past"] = race["date"] < today
            race["links"] = links.get(race["id"], [])
            race["crews_published"] = bool(race["crews_published"])
            # Draft crews are committee-only.
            race["crews"] = crews.get(race["id"], []) if committee or race["crews_published"] else []
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
                "boat_types": {k: {"rowers": n, "coxed": bool(c)} for k, (n, c) in BOAT_TYPES.items()},
                "me": {"squad": mine["squad"], "side": mine["side"], "category": mine["category"]} if mine else None}


@router.post("/api/committee/races")
def race_create(b: RaceIn, _: str = Depends(require_committee)):
    v = _validate(b)
    with db.get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO races(title, date, term, city, time_slot, entry, squad, race_type, notes, open, opens_at, closes_at, scratch_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (v["title"], v["date"], v["term"], v["city"], v["time_slot"], v["entry"], v["squad"], v["race_type"], v["notes"], v["open"], v["opens_at"], v["closes_at"], v["scratch_date"]))
        _save_links(conn, cur.lastrowid, v["links"])
        return {"id": cur.lastrowid}


@router.put("/api/committee/races/{race_id}")
def race_update(race_id: int, b: RaceIn, _: str = Depends(require_committee)):
    v = _validate(b)
    with db.get_conn() as conn:
        cur = conn.execute(
            """UPDATE races SET title=?, date=?, term=?, city=?, time_slot=?, entry=?, squad=?, race_type=?, notes=?, open=?, opens_at=?, closes_at=?, scratch_date=?
               WHERE id=?""",
            (v["title"], v["date"], v["term"], v["city"], v["time_slot"], v["entry"], v["squad"], v["race_type"], v["notes"], v["open"], v["opens_at"], v["closes_at"], v["scratch_date"], race_id))
        if not cur.rowcount:
            raise HTTPException(404, "Race not found")
        _save_links(conn, race_id, v["links"])
        return {"ok": True}


@router.delete("/api/committee/races/{race_id}")
def race_delete(race_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM races WHERE id = ?", (race_id,))
        return {"ok": True}


def _assignments(crews: list[dict]) -> dict[int, tuple[str, str]]:
    """member id -> (crew name, seat label)"""
    return {s["member_id"]: (c["name"], s["label"]) for c in crews for s in c["seats"]}


@router.put("/api/committee/races/{race_id}/crews")
def race_crews_save(race_id: int, b: CrewsIn, _: str = Depends(require_committee)):
    """Replace the race's crews. publish=False keeps (or puts) them back in draft."""
    if len(b.crews) > MAX_CREWS:
        raise HTTPException(400, f"At most {MAX_CREWS} crews")
    seen: dict[int, str] = {}
    clean = []
    for i, c in enumerate(b.crews):
        name = c.name.strip() or f"Crew {i + 1}"
        if c.boat_type not in BOAT_TYPES:
            raise HTTPException(400, f"{name}: unknown boat type")
        rowers, coxed = BOAT_TYPES[c.boat_type]
        seats = {}
        for seat, mid in c.seats.items():
            if not (0 if coxed else 1) <= seat <= rowers:
                continue                  # seat no longer in the boat (boat type changed)
            if mid in seen:
                raise HTTPException(400, f"Someone is in two seats ({seen[mid]} and {name})")
            seen[mid] = name
            seats[seat] = mid
        clean.append((name, c.boat_type, c.notes.strip(), seats))
    with db.get_conn() as conn:
        race = conn.execute("SELECT id, title, date, crews_published FROM races WHERE id = ?", (race_id,)).fetchone()
        if not race:
            raise HTTPException(404, "Race not found")
        if seen:
            ok = {r["id"] for r in conn.execute(f"SELECT id FROM members WHERE id IN ({','.join('?' * len(seen))})", list(seen))}
            if len(ok) != len(seen):
                raise HTTPException(400, "Unknown member in a crew")
        old = _load_crews(conn, [race_id]).get(race_id, [])
        before = _assignments(old) if race["crews_published"] else {}
        conn.execute("DELETE FROM race_crews WHERE race_id = ?", (race_id,))
        for pos, (name, boat_type, notes, seats) in enumerate(clean):
            cid = conn.execute("INSERT INTO race_crews(race_id, position, name, boat_type, notes) VALUES (?, ?, ?, ?, ?)",
                               (race_id, pos, name, boat_type, notes)).lastrowid
            for seat, mid in seats.items():
                conn.execute("INSERT INTO race_crew_seats(crew_id, seat, member_id) VALUES (?, ?, ?)", (cid, seat, mid))
        conn.execute("UPDATE races SET crews_published = ? WHERE id = ?", (int(b.publish), race_id))
        after = _assignments(_load_crews(conn, [race_id]).get(race_id, []))
    msgs = []
    if b.publish:
        # Tell people about a new or changed seat (and, once published, about being taken out).
        for mid, (crew, seat) in after.items():
            if before.get(mid) != (crew, seat):
                msgs.append(push._msg([mid], f"Race crew · {race['title']}", f"You're in {crew} ({'coxing' if seat == 'Cox' else seat if seat in ('Stroke', 'Bow', 'Sculler') else 'seat ' + seat}).",
                                      f"race-crew-{race_id}", "/#/races"))
        for mid in before.keys() - after.keys():
            msgs.append(push._msg([mid], f"Race crew · {race['title']}", "You're no longer in a crew for this race.",
                                  f"race-crew-{race_id}", "/#/races"))
    push.dispatch(msgs)
    return {"ok": True, "published": b.publish, "notified": len(msgs)}


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


def closing_soon(conn, days: int = 7) -> list[dict]:
    """Races whose entries close within `days` (and haven't closed yet), soonest first. For the committee banner."""
    now = datetime.now(TZ).replace(tzinfo=None)
    out = []
    for r in conn.execute("SELECT id, title, date, closes_at FROM races WHERE closes_at != '' AND date >= ? ORDER BY closes_at",
                          (now.date().isoformat(),)):
        try:
            c = datetime.fromisoformat(r["closes_at"])
        except ValueError:
            continue
        left = (c - now).total_seconds() / 3600
        if 0 <= left <= days * 24:
            out.append({"id": r["id"], "title": r["title"], "closes_at": r["closes_at"], "hours_left": round(left, 1)})
    return out
