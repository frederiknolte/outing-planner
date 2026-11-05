"""Incident and capsize log.

Anyone signed in can report an incident (capsize, collision, injury, near miss, equipment
failure): the date, crew, boat, what happened and what was done at the time. Picking the
outing fills in the boat and crew. If equipment was damaged, the report can open a boat
issue straight away, and the two stay linked.

Only the committee can read the log, because reports name people and can describe
injuries. The committee adds the follow-up (lessons, changes made), records whether and
when it was reported to British Rowing, closes it, and exports a year's incidents as CSV
for the annual safety audit.

Committee holders with notifications on get a short push alert for each new report
(type, boat and date only; no names or injury details).
"""
from __future__ import annotations

import csv
import io
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import db, push, terms
from .auth import require_committee, require_member
from .issues import SEVERITIES, create_issue
from .logic import effective_today
from .timeutil import normalize as norm_time

router = APIRouter()

KINDS = {"capsize": "Capsize", "collision": "Collision", "injury": "Injury or illness",
         "near_miss": "Near miss", "equipment": "Equipment failure", "other": "Other"}
INJURIES = {"none": "No injury", "first_aid": "Minor, first aid", "medical": "Needed medical treatment",
            "hospital": "Went to hospital"}
STATUSES = {"open": "Follow-up needed", "closed": "Closed"}


# -------------------------------------------------------------- models ----
class IncidentIn(BaseModel):
    date: str
    time: str = Field("", max_length=20)
    kind: str = "capsize"
    outing_id: Optional[int] = None
    boat_id: Optional[int] = None
    crew: str = Field("", max_length=2000)
    location: str = Field("", max_length=200)
    description: str = Field(..., max_length=8000)
    injury: str = "none"
    injury_details: str = Field("", max_length=4000)
    action_taken: str = Field("", max_length=8000)
    reported_by: str = Field("", max_length=80)
    # Equipment damaged: also open a boat issue (reporting only)
    boat_issue: bool = False
    issue_title: str = Field("", max_length=150)
    issue_severity: str = "caution"


class CommitteeIn(BaseModel):
    """Committee-only fields, sent with an edit."""
    follow_up: str = Field("", max_length=8000)
    status: str = "open"
    br_reported: bool = False
    br_reference: str = Field("", max_length=120)
    br_reported_on: str = ""
    issue_id: Optional[int] = None


class IncidentEdit(IncidentIn, CommitteeIn):
    pass


class LinkIssueIn(BaseModel):
    title: str = Field("", max_length=150)
    severity: str = "caution"
    author: str = Field("", max_length=80)


# ------------------------------------------------------------- helpers ----
def _clean(s: str) -> str:
    return " ".join((s or "").split())


def _iso(d: str, what: str, required: bool = True) -> str:
    if not d:
        if required:
            raise HTTPException(400, f"Add the {what}")
        return ""
    try:
        return date.fromisoformat(d).isoformat()
    except ValueError:
        raise HTTPException(400, f"The {what} isn't a valid date")


def academic_year(d: str) -> str:
    """'2026-11-04' -> '2026-27'. The rowing year runs September to August."""
    return terms.ay_label(terms.ay_start_of(date.fromisoformat(d)))


def _validate(conn, b: IncidentIn, today: date) -> dict:
    d = _iso(b.date, "date")
    if date.fromisoformat(d) > today:
        raise HTTPException(400, "The date is in the future")
    if b.kind not in KINDS:
        raise HTTPException(400, "Pick what kind of incident it was")
    if b.injury not in INJURIES:
        raise HTTPException(400, "Pick whether anyone was hurt")
    desc = b.description.strip()
    if not desc:
        raise HTTPException(400, "Describe what happened")
    outing_id = b.outing_id or None
    if outing_id and not conn.execute("SELECT 1 FROM outings WHERE id = ?", (outing_id,)).fetchone():
        outing_id = None
    boat_id, boat_name = b.boat_id or None, ""
    if boat_id:
        r = conn.execute("SELECT name FROM boats WHERE id = ?", (boat_id,)).fetchone()
        if not r:
            raise HTTPException(400, "That boat no longer exists")
        boat_name = r["name"]
    return {"date": d, "time": norm_time(b.time)[0][:20], "kind": b.kind, "outing_id": outing_id,
            "boat_id": boat_id, "boat_name": boat_name, "crew": b.crew.strip(), "location": _clean(b.location),
            "description": desc, "injury": b.injury,
            "injury_details": b.injury_details.strip() if b.injury != "none" else "",
            "action_taken": b.action_taken.strip()}


def _incident_or_404(conn, incident_id: int):
    r = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Incident not found")
    return r


def _today(conn) -> date:
    return effective_today(db.get_settings(conn))


def _open_boat_issue(conn, incident: dict, title: str, severity: str, who: str) -> int:
    if severity not in SEVERITIES:
        raise HTTPException(400, "Pick how serious the damage is")
    if not incident["boat_id"]:
        raise HTTPException(400, "Pick the boat that was damaged")
    title = _clean(title) or f"Damage from {KINDS[incident['kind']].lower()} on {date.fromisoformat(incident['date']).strftime('%d %b')}"
    desc = f"Logged with an incident ({KINDS[incident['kind']]}, {date.fromisoformat(incident['date']).strftime('%d %b %Y')}).\n\n{incident['description']}"
    return create_issue(conn, incident["boat_id"], title, desc, severity, who)


def _committee_member_ids(conn) -> list[int]:
    return [r[0] for r in conn.execute("SELECT DISTINCT member_id FROM committee_holders WHERE member_id IS NOT NULL")]


def linked_to_issue(conn, issue_id: int) -> list[dict]:
    """Incidents linked to a boat issue (date and type only, safe to show any rower)."""
    return [{"id": r["id"], "date": r["date"], "kind": r["kind"], "kind_label": KINDS.get(r["kind"], r["kind"])}
            for r in conn.execute("SELECT id, date, kind FROM incidents WHERE issue_id = ? ORDER BY date", (issue_id,))]


def _row(r) -> dict:
    d = dict(r)
    d["br_reported"] = bool(d["br_reported"])
    d["year"] = academic_year(d["date"])
    return d


# -------------------------------------------------------------- routes ----
@router.get("/api/incidents/meta")
def meta(_: str = Depends(require_member)):
    return {"kinds": KINDS, "injuries": INJURIES, "statuses": STATUSES, "severities": SEVERITIES}


@router.get("/api/incidents/outings")
def outings_on(day: str, role: str = Depends(require_member)):
    """Outings on a day, with boat and crew, so a report can be filled in by picking one."""
    d = _iso(day, "date")
    with db.get_conn() as conn:
        rows = conn.execute(
            f"""SELECT o.id, o.kind, o.time, o.end_time, o.title, o.location, o.boat_id, b.name AS boat_name
                FROM outings o LEFT JOIN boats b ON b.id = o.boat_id
                WHERE o.date = ? AND o.cancelled = 0 {"" if role == "committee" else "AND o.published = 1"}
                ORDER BY o.kind = 'land', o.time""", (d,)).fetchall()
        crews = {}
        if rows:
            for c in conn.execute(f"""SELECT a.outing_id, a.seat, m.name FROM assignments a JOIN members m ON m.id = a.member_id
                                      WHERE a.outing_id IN ({','.join('?' * len(rows))}) ORDER BY a.seat = 0, a.seat DESC""",
                                  [o["id"] for o in rows]):
                crews.setdefault(c["outing_id"], []).append(c)
        return {"outings": [{**dict(o), "crew": [f"{c['name']} (cox)" if o["kind"] == "water" and c["seat"] == 0 else c["name"]
                                                 for c in crews.get(o["id"], [])]} for o in rows]}


@router.post("/api/incidents")
def incident_create(b: IncidentIn, _: str = Depends(require_member)):
    who = _clean(b.reported_by)
    if not who:
        raise HTTPException(400, "Add your name")
    with db.get_conn() as conn:
        v = _validate(conn, b, _today(conn))
        cur = conn.execute(
            """INSERT INTO incidents(date, time, kind, outing_id, boat_id, boat_name, crew, location, description,
                                     injury, injury_details, action_taken, reported_by)
               VALUES (:date, :time, :kind, :outing_id, :boat_id, :boat_name, :crew, :location, :description,
                       :injury, :injury_details, :action_taken, :who)""", {**v, "who": who})
        iid, issue_id = cur.lastrowid, None
        if b.boat_issue:
            issue_id = _open_boat_issue(conn, v, b.issue_title, b.issue_severity, who)
            conn.execute("UPDATE incidents SET issue_id = ? WHERE id = ?", (issue_id, iid))
        to = _committee_member_ids(conn)
    when = date.fromisoformat(v["date"]).strftime("%a %d %b").replace(" 0", " ")
    push.dispatch([{"to": to, "urgency": "high", "payload": {
        "title": f"Incident reported: {KINDS[v['kind']].lower()}",
        "body": f"{v['boat_name'] or 'No boat given'} · {when}. Open the incident log for details.",
        "tag": f"incident-{iid}", "url": "/#/incidents"}}] if to else [])
    return {"id": iid, "issue_id": issue_id}


@router.get("/api/committee/incidents")
def incidents_list(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        rows = [_row(r) for r in conn.execute(
            """SELECT i.*, bi.title AS issue_title, bi.status AS issue_status
               FROM incidents i LEFT JOIN boat_issues bi ON bi.id = i.issue_id
               ORDER BY i.date DESC, i.time DESC, i.id DESC""")]
        today = _today(conn)
    return {"incidents": rows, "kinds": KINDS, "injuries": INJURIES, "statuses": STATUSES,
            "this_year": academic_year(today.isoformat()), "today": today.isoformat()}


@router.get("/api/committee/incidents/summary")
def incidents_summary(_: str = Depends(require_committee)):
    """Counts for the to-do page: open follow-ups and incidents not yet reported to British Rowing."""
    with db.get_conn() as conn:
        year = academic_year(_today(conn).isoformat())
        rows = conn.execute("SELECT date, status, br_reported FROM incidents").fetchall()
    this = [r for r in rows if academic_year(r["date"]) == year]
    return {"year": year, "this_year": len(this), "open": sum(r["status"] == "open" for r in rows),
            "not_reported": sum(not r["br_reported"] for r in this)}


@router.get("/api/committee/incidents/{incident_id}")
def incident_detail(incident_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        i = _row(_incident_or_404(conn, incident_id))
        i["issue"] = None
        if i["issue_id"]:
            r = conn.execute("""SELECT bi.id, bi.title, bi.status, b.name AS boat_name FROM boat_issues bi
                                JOIN boats b ON b.id = bi.boat_id WHERE bi.id = ?""", (i["issue_id"],)).fetchone()
            i["issue"] = dict(r) if r else None
        i["outing"] = None
        if i["outing_id"]:
            r = conn.execute("SELECT id, date, time, end_time, kind, title FROM outings WHERE id = ?", (i["outing_id"],)).fetchone()
            i["outing"] = dict(r) if r else None
        if i["boat_id"]:   # issues for this boat, to link one by hand
            i["boat_issues"] = [dict(r) for r in conn.execute(
                "SELECT id, title, status, created_at FROM boat_issues WHERE boat_id = ? ORDER BY created_at DESC LIMIT 50",
                (i["boat_id"],))]
        else:
            i["boat_issues"] = []
        return i


@router.put("/api/committee/incidents/{incident_id}")
def incident_edit(incident_id: int, b: IncidentEdit, _: str = Depends(require_committee)):
    if b.status not in STATUSES:
        raise HTTPException(400, "Unknown status")
    with db.get_conn() as conn:
        old = _incident_or_404(conn, incident_id)
        v = _validate(conn, b, _today(conn))
        if not v["boat_id"] and old["boat_id"] is None:
            v["boat_name"] = old["boat_name"]          # boat was deleted since: keep the name on record
        br_on = _iso(b.br_reported_on, "date reported to British Rowing", required=False) if b.br_reported else ""
        issue_id = b.issue_id or None
        if issue_id and not conn.execute("SELECT 1 FROM boat_issues WHERE id = ?", (issue_id,)).fetchone():
            raise HTTPException(400, "That boat issue no longer exists")
        conn.execute(
            """UPDATE incidents SET date=:date, time=:time, kind=:kind, outing_id=:outing_id, boat_id=:boat_id,
                 boat_name=:boat_name, crew=:crew, location=:location, description=:description, injury=:injury,
                 injury_details=:injury_details, action_taken=:action_taken, follow_up=:follow_up, status=:status,
                 br_reported=:br_reported, br_reference=:br_reference, br_reported_on=:br_on, issue_id=:issue_id,
                 updated_at=datetime('now')
               WHERE id=:id""",
            {**v, "follow_up": b.follow_up.strip(), "status": b.status, "br_reported": int(b.br_reported),
             "br_reference": _clean(b.br_reference) if b.br_reported else "", "br_on": br_on,
             "issue_id": issue_id, "id": incident_id})
        return {"ok": True}


@router.post("/api/committee/incidents/{incident_id}/boat-issue")
def incident_boat_issue(incident_id: int, b: LinkIssueIn, _: str = Depends(require_committee)):
    """Open a boat issue for equipment damaged in this incident and link it."""
    with db.get_conn() as conn:
        i = dict(_incident_or_404(conn, incident_id))
        if i["issue_id"]:
            raise HTTPException(400, "This incident already has a boat issue")
        issue_id = _open_boat_issue(conn, i, b.title, b.severity, _clean(b.author) or "Committee")
        conn.execute("UPDATE incidents SET issue_id = ?, updated_at = datetime('now') WHERE id = ?", (issue_id, incident_id))
        return {"issue_id": issue_id}


@router.delete("/api/committee/incidents/{incident_id}")
def incident_delete(incident_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM incidents WHERE id = ?", (incident_id,))
        return {"ok": True}


@router.get("/api/committee/incidents.csv")
def incidents_csv(year: str = "", _: str = Depends(require_committee)):
    """All incidents, or one rowing year (e.g. 2026-27), for the safety audit."""
    with db.get_conn() as conn:
        rows = [_row(r) for r in conn.execute(
            """SELECT i.*, bi.title AS issue_title FROM incidents i LEFT JOIN boat_issues bi ON bi.id = i.issue_id
               ORDER BY i.date, i.time, i.id""")]
    if year:
        rows = [r for r in rows if r["year"] == year]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Time", "Type", "Boat", "Crew", "Location", "What happened", "Injury", "Injury details",
                "Action taken at the time", "Follow-up", "Status", "Reported to British Rowing", "BR reference",
                "BR reported on", "Boat issue", "Reported by", "Logged at (UTC)"])
    for r in rows:
        w.writerow([r["date"], r["time"], KINDS.get(r["kind"], r["kind"]), r["boat_name"], r["crew"], r["location"],
                    r["description"], INJURIES.get(r["injury"], r["injury"]), r["injury_details"], r["action_taken"],
                    r["follow_up"], STATUSES.get(r["status"], r["status"]), "Yes" if r["br_reported"] else "No",
                    r["br_reference"], r["br_reported_on"], r["issue_title"] or "", r["reported_by"], r["created_at"]])
    name = f"incidents-{year}.csv" if year else "incidents.csv"
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={name}"})
