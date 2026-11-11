"""The boat park: the club's boats, readable by everyone, edited by the committee."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, issues
from .auth import require_committee, require_member
from .common import today, unique_name
from .logic import BOAT_TYPES

router = APIRouter()


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
        rows = [dict(r) for r in conn.execute("SELECT * FROM boats ORDER BY status != 'available', seats DESC, name")]
        usage = {r["boat_id"]: r["n"] for r in conn.execute(
            "SELECT boat_id, COUNT(*) n FROM outings WHERE boat_id IS NOT NULL AND cancelled = 0 GROUP BY boat_id")}
        nxt = {r["boat_id"]: r["d"] for r in conn.execute(
            "SELECT boat_id, MIN(date) d FROM outings WHERE boat_id IS NOT NULL AND cancelled = 0 AND date >= ? GROUP BY boat_id",
            (today(conn).isoformat(),))}
        open_issues = {}
        for r in conn.execute("SELECT boat_id, severity FROM boat_issues WHERE status IN ('open', 'in_progress', 'waiting')"):
            n, worst = open_issues.get(r["boat_id"], (0, ""))
            if issues.SEVERITY_RANK[r["severity"]] > issues.SEVERITY_RANK.get(worst, 0):
                worst = r["severity"]
            open_issues[r["boat_id"]] = (n + 1, worst)
        for r in rows:
            r["open_issues"], r["worst_issue"] = open_issues.get(r["id"], (0, ""))
            r["outings"] = usage.get(r["id"], 0)
            r["next_outing"] = nxt.get(r["id"])
        return {"boats": rows, "types": {k: {"seats": v[0], "coxed": bool(v[1])} for k, v in BOAT_TYPES.items()}}


def _fields(b: BoatIn) -> tuple:
    if b.status not in ("available", "repair", "retired"):
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
