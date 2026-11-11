"""The boat park: the club's boats, readable by everyone, edited by the committee.

A boat's **condition** is what everyone sees and what decides whether it can be used. It combines the status the
committee sets on the boat (available, under repair, retired) with its worst open issue: an issue marked "Do not
use" or "Use with care" makes an available boat show as that until the issue is fixed or closed. Always use
`boats_by_id()` (or the `condition` it adds) rather than reading `boats.status` directly.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, issues
from .auth import require_committee, require_member
from .common import today, unique_name
from .logic import BOAT_TYPES

router = APIRouter()

STATUSES = {"available": "Available", "repair": "Under repair", "retired": "Retired"}   # set by the committee
# condition -> (label, chip tone, can be used), from worst to best
CONDITIONS = {
    "retired": (STATUSES["retired"], "", False),
    "repair": (STATUSES["repair"], "warn", False),
    "unusable": (issues.SEVERITIES["unusable"], "bad", False),
    "caution": (issues.SEVERITIES["caution"], "warn", True),
    "available": (STATUSES["available"], "ok", True),
}
_RANK = {k: i for i, k in enumerate(CONDITIONS)}


def condition(status: str, worst_issue: str) -> dict:
    """The boat's condition from its status and the severity of its worst open issue ('' if none)."""
    key = status if status != "available" else worst_issue if worst_issue in CONDITIONS else "available"
    label, tone, usable = CONDITIONS[key]
    return {"key": key, "label": label, "tone": tone, "usable": usable}


def boats_by_id(conn) -> dict:
    """Every boat keyed by id, with its open issue count, worst open issue and condition."""
    worst = issues.worst_open(conn)
    out = {}
    for r in conn.execute("SELECT * FROM boats"):
        b = dict(r)
        b["open_issues"], b["worst_issue"] = worst.get(b["id"], (0, ""))
        b["condition"] = condition(b["status"], b["worst_issue"])
        out[b["id"]] = b
    return out


def in_order(boats: dict) -> list[dict]:
    """Boats as the boat park lists them: usable ones first, then by size and name."""
    return sorted(boats.values(), key=lambda b: (_RANK[b["condition"]["key"]] < _RANK["caution"], -b["seats"], b["name"]))


class BoatIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    boat_type: str = "8+"
    seats: int = Field(8, ge=1, le=8)
    coxed: bool = True
    status: str = "available"
    rigging: str = Field("", max_length=120)
    notes: str = Field("", max_length=500)


@router.get("/api/committee/boats")
def boats_list(role: str = Depends(require_member)):
    # readable by everyone signed in (boat park view); edits are committee only
    with db.get_conn() as conn:
        rows = in_order(boats_by_id(conn))
        usage = {r["boat_id"]: r["n"] for r in conn.execute(
            "SELECT boat_id, COUNT(*) n FROM outings WHERE boat_id IS NOT NULL AND cancelled = 0 GROUP BY boat_id")}
        nxt = {r["boat_id"]: r["d"] for r in conn.execute(
            "SELECT boat_id, MIN(date) d FROM outings WHERE boat_id IS NOT NULL AND cancelled = 0 AND date >= ? GROUP BY boat_id",
            (today(conn).isoformat(),))}
        for r in rows:
            r["outings"] = usage.get(r["id"], 0)
            r["next_outing"] = nxt.get(r["id"])
        return {"boats": rows, "statuses": STATUSES,
                "types": {k: {"seats": v[0], "coxed": bool(v[1])} for k, v in BOAT_TYPES.items()}}


def _fields(b: BoatIn) -> tuple:
    if b.status not in STATUSES:
        raise HTTPException(400, "Bad status")
    if b.boat_type not in BOAT_TYPES:
        raise HTTPException(400, "Bad boat type")
    return b.name.strip(), b.boat_type, b.seats, int(b.coxed), b.status, b.rigging, b.notes


@router.post("/api/committee/boats")
def boat_create(b: BoatIn, _: str = Depends(require_committee)):
    fields = _fields(b)
    with db.get_conn() as conn, unique_name("boat"):
        cur = conn.execute("INSERT INTO boats(name, boat_type, seats, coxed, status, rigging, notes) VALUES (?,?,?,?,?,?,?)", fields)
        return {"id": cur.lastrowid}


@router.put("/api/committee/boats/{boat_id}")
def boat_update(boat_id: int, b: BoatIn, _: str = Depends(require_committee)):
    fields = _fields(b)
    with db.get_conn() as conn, unique_name("boat"):
        conn.execute("UPDATE boats SET name=?, boat_type=?, seats=?, coxed=?, status=?, rigging=?, notes=? WHERE id=?", fields + (boat_id,))
        return {"ok": True}


@router.delete("/api/committee/boats/{boat_id}")
def boat_delete(boat_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        issues.delete_boat_photos(conn, boat_id)
        conn.execute("DELETE FROM boats WHERE id=?", (boat_id,))
        return {"ok": True}
