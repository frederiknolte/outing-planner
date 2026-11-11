"""Small helpers shared by the routers: checking request values, and queries several endpoints repeat."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date
from typing import Optional

from fastapi import HTTPException

from . import db
from .logic import effective_today, monday_of, to_date
from .timeutil import normalize as norm_time, to_minutes


# ------------------------------------------------------------- request values ----
def parse_date(text: str, error: str = "Bad date") -> date:
    """A YYYY-MM-DD date from a request, or a 400 with `error`."""
    d = to_date(text)
    if d is None:
        raise HTTPException(400, error)
    return d


def optional_date(text: str, error: str = "Bad date") -> str:
    """'' for a blank value, else the date as YYYY-MM-DD (400 with `error` if it isn't one)."""
    text = (text or "").strip()
    return parse_date(text, error).isoformat() if text else ""


def parse_times(start_text: str, end_text: str = "", example: str = "08:00") -> tuple[str, str]:
    """Start and end as "HH:MM" ("6-8pm" in the start works too). The end must come after the start, and is
    dropped when there's no readable start time."""
    start, end = norm_time(start_text)
    if end_text.strip():
        end = norm_time(end_text)[0]
        if to_minutes(end) is None:
            raise HTTPException(400, f"End time not recognised. Use e.g. {example}")
    if to_minutes(start) is None:
        return start, ""
    if end and to_minutes(end) <= to_minutes(start):
        raise HTTPException(400, "The end time must be after the start time")
    return start, end


def monday_param(text: str) -> date:
    """The Monday of the week a request names by any of its dates."""
    return monday_of(parse_date(text))


def problems_error(prefix: str, status: dict) -> None:
    """400 listing why someone can't take a place (a `candidates` entry), unless they can."""
    if not status["ok"]:
        raise HTTPException(400, f"{prefix}: " + "; ".join(status["problems"]))


@contextmanager
def unique_name(what: str):
    """Turn a clash on a UNIQUE name column into a readable 400."""
    try:
        yield
    except db.sqlite3.IntegrityError:
        raise HTTPException(400, f"A {what} with that name already exists")


# --------------------------------------------------------------- queries ----
def today(conn) -> date:
    """'Today' for the club (the committee can override it in the settings for testing)."""
    return effective_today(db.get_settings(conn))


def published_only(committee: bool, column: str = "published") -> str:
    """SQL to add to a WHERE clause so rowers only see published rows."""
    return "" if committee else f" AND {column} = 1"


def boats_by_id(conn) -> dict:
    return {r["id"]: dict(r) for r in conn.execute("SELECT * FROM boats")}


def visible_outing(conn, oid: int, role: str, what: str = "Outing", upcoming: bool = False):
    """An outing the caller may see (drafts are committee-only), else 404. With `upcoming`, also
    400 if it's in the past or cancelled, for changes a rower makes."""
    o = conn.execute("SELECT * FROM outings WHERE id = ?", (oid,)).fetchone()
    if not o or (not o["published"] and role != "committee"):
        raise HTTPException(404, f"{what} not found")
    if upcoming:
        require_upcoming(conn, o, what)
    return o


def require_upcoming(conn, o, what: str = "Outing") -> None:
    """400 if the outing is in the past or cancelled."""
    if o["date"] < today(conn).isoformat():
        raise HTTPException(400, f"This {what.lower()} is in the past")
    if o["cancelled"]:
        raise HTTPException(400, f"This {what.lower()} has been cancelled")


def busy_at(conn, o, exclude_id: Optional[int] = None) -> set[int]:
    """Members seated in another (not cancelled) outing at the same date and time as o."""
    if not o["time"]:
        return set()
    return {r[0] for r in conn.execute(
        """SELECT a.member_id FROM assignments a JOIN outings x ON x.id = a.outing_id
           WHERE x.date = ? AND x.time = ? AND x.id != ? AND x.cancelled = 0""", (o["date"], o["time"], exclude_id or -1))}


# ---------------------------------------------------------- sub requests ----
def resolve_sub(conn, sr_id: int, sub_id: Optional[int] = None) -> None:
    """Close one sub request: filled by `sub_id`, or cancelled if there's no sub."""
    if sub_id:
        conn.execute("UPDATE sub_requests SET status = 'filled', sub_id = ?, resolved_at = datetime('now') WHERE id = ?",
                     (sub_id, sr_id))
    else:
        conn.execute("UPDATE sub_requests SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ?", (sr_id,))


def cancel_open_subs(conn, oid: int, seat: Optional[int] = None) -> None:
    """Cancel the open sub requests of an outing (or of one seat in it)."""
    conn.execute("""UPDATE sub_requests SET status = 'cancelled', resolved_at = datetime('now')
                    WHERE outing_id = ? AND status = 'open'""" + ("" if seat is None else " AND seat = ?"),
                 (oid,) if seat is None else (oid, seat))


def settle_open_subs(conn, oid: int, seats: dict[int, int], fill: bool) -> list[tuple[int, int]]:
    """After a crew change: open sub requests whose requester has left the seat are closed. With `fill`,
    a request counts as filled by whoever now sits there. Returns (requester, sub) for each filled one."""
    filled = []
    for sr in conn.execute("SELECT * FROM sub_requests WHERE outing_id = ? AND status = 'open'", (oid,)).fetchall():
        now = seats.get(sr["seat"])
        if now != sr["requester_id"]:
            sub = now if fill else None
            resolve_sub(conn, sr["id"], sub)
            if sub:
                filled.append((sr["requester_id"], sub))
    return filled
