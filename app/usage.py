"""Boat usage: outings and hours on the water per boat, for planning servicing and spotting idle boats.

A water outing counts once it has happened: published, not cancelled, dated before "today", and
with a boat set. Hours come from the start and end time. Without an end time (or with a time that
can't be read), 90 minutes are assumed, the same as the river-rule checks and calendar feeds use.

Each boat can carry a "last serviced" date. Usage since then is counted over all time, whatever
period is picked, so the committee can service by use. An optional service interval (hours) flags
boats that are due.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import db
from .auth import require_committee, require_member
from .logic import Rules
from .stats import _season_start, _term_start
from . import timeutil
from .timeutil import to_minutes

router = APIRouter()

DEFAULT_MINUTES = timeutil.DEFAULT_MINUTES["water"]
IDLE_DAYS = 30          # an in-service boat unused for this long is flagged as idle
PERIODS = ("season", "term", "30d", "all")


def outing_minutes(time: str, end_time: str) -> tuple[int, bool]:
    """(minutes on the water, whether that's the 90-minute assumption)."""
    s, e = to_minutes(time or ""), to_minutes(end_time or "")
    if s is None or e is None or e <= s:
        return DEFAULT_MINUTES, True
    return e - s, False


def _interval(settings: dict) -> Optional[float]:
    try:
        v = float(settings.get("service_interval_hours") or 0)
    except ValueError:
        return None
    return v if v > 0 else None


@router.get("/api/boats/usage")
def boat_usage(period: str = "season", _: str = Depends(require_member)):
    if period not in PERIODS:
        raise HTTPException(400, "Bad period")
    with db.get_conn() as conn:
        rules = Rules(conn)
        today = rules.today
        season = _season_start(rules)
        since = {"season": season, "term": _term_start(rules, season),
                 "30d": today - timedelta(days=30), "all": None}[period]
        interval = _interval(rules.settings)

        boats = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM boats")}
        for b in boats.values():
            b.update(outings=0, minutes=0, assumed=0, last_used=None, first_used=None,
                     svc_outings=0, svc_minutes=0, upcoming=0, next_outing=None, recent=0)

        rows = conn.execute("""SELECT boat_id, date, time, end_time FROM outings
                               WHERE kind = 'water' AND boat_id IS NOT NULL AND published = 1 AND cancelled = 0
                                 AND date < ?""", (today.isoformat(),)).fetchall()
        recent_from = (today - timedelta(days=IDLE_DAYS)).isoformat()
        for r in rows:
            b = boats.get(r["boat_id"])
            if not b:
                continue
            mins, assumed = outing_minutes(r["time"], r["end_time"])
            d = r["date"]
            b["last_used"] = max(b["last_used"] or d, d)
            b["first_used"] = min(b["first_used"] or d, d)
            if d >= recent_from:
                b["recent"] += 1
            if since is None or d >= since.isoformat():
                b["outings"] += 1
                b["minutes"] += mins
                b["assumed"] += assumed
            if not b["last_serviced"] or d >= b["last_serviced"]:   # never serviced: all use counts
                b["svc_outings"] += 1
                b["svc_minutes"] += mins

        for r in conn.execute("""SELECT boat_id, COUNT(*) n, MIN(date) d FROM outings
                                 WHERE kind = 'water' AND boat_id IS NOT NULL AND published = 1 AND cancelled = 0
                                   AND date >= ? GROUP BY boat_id""", (today.isoformat(),)):
            if r["boat_id"] in boats:
                boats[r["boat_id"]]["upcoming"] = r["n"]
                boats[r["boat_id"]]["next_outing"] = r["d"]

        out = []
        for b in boats.values():
            idle_days = (today - date.fromisoformat(b["last_used"])).days if b["last_used"] else None
            svc_hours = round(b["svc_minutes"] / 60, 1)
            out.append({
                "id": b["id"], "name": b["name"], "boat_type": b["boat_type"], "status": b["status"],
                "outings": b["outings"], "hours": round(b["minutes"] / 60, 1), "assumed": b["assumed"],
                "last_used": b["last_used"], "idle_days": idle_days, "recent": b["recent"],
                "upcoming": b["upcoming"], "next_outing": b["next_outing"],
                "idle": b["status"] == "available" and b["recent"] == 0 and not b["upcoming"],
                "last_serviced": b["last_serviced"] or None,
                "since_service": {"outings": b["svc_outings"], "hours": svc_hours},
                "service_due": bool(interval and svc_hours >= interval and b["status"] != "retired"),
                "service_pct": round(min(svc_hours / interval, 9.99) * 100) if interval else None,
            })
        out.sort(key=lambda x: (x["status"] == "retired", -x["hours"], -x["outings"], x["name"].lower()))

        in_service = [b for b in out if b["status"] != "retired"]
        return {
            "period": period, "since": since.isoformat() if since else None, "today": today.isoformat(),
            "idle_after_days": IDLE_DAYS, "default_minutes": DEFAULT_MINUTES,
            "service_interval_hours": interval,
            "totals": {
                "outings": sum(b["outings"] for b in out),
                "hours": round(sum(b["hours"] for b in out), 1),
                "assumed": sum(b["assumed"] for b in out),
                "used": sum(1 for b in in_service if b["outings"]),
                "in_service": len(in_service),
                "idle": sum(1 for b in out if b["idle"]),
                "due": sum(1 for b in out if b["service_due"]),
            },
            "boats": out,
        }


class ServicedIn(BaseModel):
    date: str = ""          # YYYY-MM-DD; blank clears it


@router.put("/api/committee/boats/{boat_id}/serviced")
def boat_serviced(boat_id: int, b: ServicedIn, _: str = Depends(require_committee)):
    d = b.date.strip()
    if d:
        try:
            date.fromisoformat(d)
        except ValueError:
            raise HTTPException(400, "Bad date")
    with db.get_conn() as conn:
        if not conn.execute("SELECT 1 FROM boats WHERE id = ?", (boat_id,)).fetchone():
            raise HTTPException(404, "Unknown boat")
        conn.execute("UPDATE boats SET last_serviced = ? WHERE id = ?", (d, boat_id))
        return {"ok": True}


class IntervalIn(BaseModel):
    hours: float = 0        # 0 = off


@router.put("/api/committee/service-interval")
def service_interval(b: IntervalIn, _: str = Depends(require_committee)):
    if b.hours < 0 or b.hours > 10000:
        raise HTTPException(400, "Bad interval")
    with db.get_conn() as conn:
        db.set_setting(conn, "service_interval_hours", f"{b.hours:g}" if b.hours else "")
        return {"ok": True}
