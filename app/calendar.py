"""Personal iCalendar (.ics) subscription feeds.

Each member gets a secret, unguessable feed URL (calendar apps can't log in, so
the token *is* the credential). The feed lists the published outings they're
seated in, plus sessions where they're named as coach/bankrider. Calendar apps
poll it, so changes to crews, subs and times show up automatically.
"""
from __future__ import annotations

import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from . import db
from .auth import require_member
from .logic import TZ, real_today, seat_label
from .timeutil import parse_time

router = APIRouter()

DURATION = {"water": timedelta(minutes=90), "land": timedelta(minutes=60)}
HISTORY_DAYS = 60


# ------------------------------------------------------------------ ics ----
def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545: lines longer than 75 octets are folded with CRLF + space."""
    b = line.encode()
    if len(b) <= 75:
        return line
    out, cur = [], b""
    for ch in line:
        e = ch.encode()
        if len(cur) + len(e) > (75 if not out else 74):
            out.append(cur.decode())
            cur = b""
        cur += e
    out.append(cur.decode())
    return "\r\n ".join(out)


def _utc(d: date, hm: tuple[int, int]) -> str:
    local = datetime(d.year, d.month, d.day, hm[0], hm[1], tzinfo=TZ)
    return local.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_feed(conn, member: dict, base_url: str) -> str:
    club = db.get_settings(conn).get("club_name") or "Boat Club"
    since = (real_today() - timedelta(days=HISTORY_DAYS)).isoformat()
    members = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM members")}
    boats = {r["id"]: r for r in conn.execute("SELECT id, name, boat_type FROM boats")}
    places = {r["name"].lower(): dict(r) for r in conn.execute("SELECT * FROM places")}

    # outings they're seated in
    rows = conn.execute(
        """SELECT o.*, a.seat AS my_seat FROM assignments a JOIN outings o ON o.id = a.outing_id
           WHERE a.member_id = ? AND o.published = 1 AND o.date >= ?""", (member["id"], since)).fetchall()
    events = {r["id"]: (dict(r), "seat") for r in rows}
    # outings where they're coach / bankrider (name appears in the coach field)
    name = member["name"].lower()
    for r in conn.execute("SELECT * FROM outings WHERE published = 1 AND date >= ? AND coach != ''", (since,)):
        if r["id"] not in events and name in r["coach"].lower():
            events[r["id"]] = (dict(r), "coach")

    crews: dict[int, list] = {}
    sub_open = set()
    if events:
        ids = list(events)
        qs = ",".join("?" * len(ids))
        for a in conn.execute(f"SELECT outing_id, seat, member_id FROM assignments WHERE outing_id IN ({qs})", ids):
            crews.setdefault(a["outing_id"], []).append(a)
        for s in conn.execute(
                f"SELECT outing_id FROM sub_requests WHERE status = 'open' AND requester_id = ? AND outing_id IN ({qs})",
                [member["id"], *ids]):
            sub_open.add(s["outing_id"])

    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    host = re.sub(r"^https?://", "", base_url).strip("/").split("/")[0] or "outing-planner"
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Outing Planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_esc(club)} – {_esc(member['name'])}",
        f"X-WR-CALDESC:{_esc('Your outings with ' + club)}",
        "X-WR-TIMEZONE:Europe/London", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
    ]
    for oid, (o, why) in sorted(events.items(), key=lambda kv: (kv[1][0]["date"], kv[1][0]["time"])):
        d = date.fromisoformat(o["date"])
        kind = "Water outing" if o["kind"] == "water" else "Land training"
        if why == "seat":
            role = seat_label(o["my_seat"], o["capacity"], o["kind"])
            role_txt = (role if not role.isdigit() else f"Seat {role}") if o["kind"] == "water" else "Booked"
        else:
            role_txt = "Coach / bankrider" if o["kind"] == "water" else "Coach"
        summary = f"{o['title'] or kind} ({role_txt})" if o["title"] else f"{kind} ({role_txt})"
        if oid in sub_open:
            summary = "[Sub requested] " + summary
        crew = sorted(crews.get(oid, []), key=lambda a: (a["seat"] != 0, -a["seat"] if o["kind"] == "water" else a["seat"]))
        desc = [f"{club} · {kind}"]
        if o["boat_id"] and o["boat_id"] in boats:
            desc.append(f"Boat: {boats[o['boat_id']]['name']} ({boats[o['boat_id']]['boat_type']})")
        if o["coach"]:
            desc.append(f"Coach / bankrider: {o['coach']}")
        if crew:
            desc.append("")
            desc.append("Crew:")
            for a in crew:
                desc.append(f"  {seat_label(a['seat'], o['capacity'], o['kind'])}: {members.get(a['member_id'], '?')}")
        if o["notes"]:
            desc += ["", o["notes"]]
        if oid in sub_open:
            desc += ["", "You've asked for a sub. This stays in your calendar until someone takes your seat."]
        desc += ["", f"Schedule: {base_url.rstrip('/')}/#/schedule"]

        t = parse_time(o["time"])
        t_end = parse_time(o["end_time"]) if o["end_time"] else None
        ev = ["BEGIN:VEVENT", f"UID:outing-{oid}-m{member['id']}@{host}", f"DTSTAMP:{now}"]
        if t:
            start = t[0]
            end = t_end[0] if t_end else t[1]
            sdt = datetime(d.year, d.month, d.day, *start)
            edt = datetime(d.year, d.month, d.day, *end) if end else sdt + DURATION[o["kind"]]
            if edt <= sdt:
                edt = sdt + DURATION[o["kind"]]
            ev += [f"DTSTART:{_utc(d, start)}", f"DTEND:{_utc(edt.date(), (edt.hour, edt.minute))}"]
        else:
            ev += [f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}",
                   f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}"]
            desc.insert(1, "Time to be confirmed")
        ev += [f"SUMMARY:{_esc(summary)}", f"DESCRIPTION:{_esc(chr(10).join(desc))}"]
        if o["location"]:
            ev += _location_lines(o["location"], places.get(o["location"].strip().lower()))
        ev += ["STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT"]
        lines += ev
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in lines) + "\r\n"


def _location_lines(name: str, place: Optional[dict]) -> list[str]:
    """LOCATION with the full address (so phones can navigate), plus an exact pin when coordinates are known."""
    if not place or not (place.get("address") or place.get("lat") is not None):
        return [f"LOCATION:{_esc(name)}"]
    addr = place.get("address") or ""
    label = f"{place['name']}, {addr}" if addr else place["name"]
    lines = [f"LOCATION:{_esc(label)}"]
    if place.get("lat") is not None and place.get("lon") is not None:
        lat, lon = place["lat"], place["lon"]
        lines.append(f"GEO:{lat:.6f};{lon:.6f}")
        q = lambda v: (v or "").replace('"', "'")
        lines.append(f'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="{q(addr)}";X-APPLE-RADIUS=70;'
                     f'X-TITLE="{q(place["name"])}":geo:{lat:.6f},{lon:.6f}')
    return lines


# ------------------------------------------------------------- routes -----
def _base(request: Request) -> str:
    """Public address used in feed links. Set PUBLIC_URL when behind a proxy that hides the real host."""
    return (os.environ.get("PUBLIC_URL") or str(request.base_url)).rstrip("/")


def _links(request: Request, token: str) -> dict:
    https = f"{_base(request)}/cal/{token}.ics"
    webcal = re.sub(r"^https?://", "webcal://", https)
    from urllib.parse import quote
    return {"url": https, "webcal": webcal,
            "google": "https://calendar.google.com/calendar/r?cid=" + quote(webcal, safe=""),
            "outlook": "https://outlook.live.com/calendar/0/addfromweb?url=" + quote(https, safe="")
                       + "&name=" + quote("Rowing outings", safe="")}


@router.post("/api/calendar/{member_id}")
def calendar_link(member_id: int, request: Request, role: str = Depends(require_member)):
    """Get (creating if needed) the member's personal feed link."""
    with db.get_conn() as conn:
        m = conn.execute("SELECT id, cal_token FROM members WHERE id = ?", (member_id,)).fetchone()
        if not m:
            raise HTTPException(404, "Unknown member")
        token = m["cal_token"]
        if not token:
            token = secrets.token_urlsafe(24)
            conn.execute("UPDATE members SET cal_token = ? WHERE id = ?", (token, member_id))
        return _links(request, token)


@router.post("/api/calendar/{member_id}/reset")
def calendar_reset(member_id: int, request: Request, role: str = Depends(require_member)):
    """Issue a new link; the old one stops working (e.g. if it was shared by mistake)."""
    with db.get_conn() as conn:
        if not conn.execute("SELECT 1 FROM members WHERE id = ?", (member_id,)).fetchone():
            raise HTTPException(404, "Unknown member")
        token = secrets.token_urlsafe(24)
        conn.execute("UPDATE members SET cal_token = ? WHERE id = ?", (token, member_id))
        return _links(request, token)


@router.get("/cal/{token}.ics")
def calendar_feed(token: str, request: Request):
    if len(token) < 20:
        raise HTTPException(404, "Not found")
    with db.get_conn() as conn:
        m = conn.execute("SELECT * FROM members WHERE cal_token = ?", (token,)).fetchone()
        if not m:
            raise HTTPException(404, "This calendar link is no longer valid")
        body = build_feed(conn, dict(m), _base(request))
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'inline; filename="outings.ics"',
                             "Cache-Control": "no-cache, max-age=0"})
