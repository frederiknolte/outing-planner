"""The schedule: start-up data for the app, and the Week and Month views of outings, races and socials."""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from . import crewlog, db, river
from .auth import require_member
from .boats import boats_by_id
from .common import parse_date, published_only
from .logic import TZ, Rules, add_months, monday_of, outing_payload, to_date
from .races import closing_soon, is_associate, week_races
from .socials import week_socials

router = APIRouter()


def outings_payload(conn, rules: Rules, where: str, params: tuple, committee: bool) -> list[dict]:
    """Full outing payloads (crew, subs, warnings, river checks, change log) for the outings matching `where`."""
    outings = [dict(r) for r in conn.execute(f"SELECT * FROM outings WHERE {where} ORDER BY date, time, id", params)]
    if not outings:
        return []
    ids = [o["id"] for o in outings]
    qs = ",".join("?" * len(ids))
    assigns = defaultdict(list)
    for r in conn.execute(f"SELECT * FROM assignments WHERE outing_id IN ({qs})", ids):
        assigns[r["outing_id"]].append(dict(r))
    subs = defaultdict(list)
    for r in conn.execute(f"SELECT * FROM sub_requests WHERE outing_id IN ({qs}) AND status != 'cancelled'", ids):
        subs[r["outing_id"]].append(dict(r))
    # double-booking detection: same date+time, any outing
    dates = sorted({o["date"] for o in outings})
    dq = ",".join("?" * len(dates))
    slot = defaultdict(lambda: defaultdict(list))  # (date,time) -> member -> [outing ids]
    for r in conn.execute(
        f"""SELECT a.member_id, o.id, o.date, o.time FROM assignments a JOIN outings o ON o.id = a.outing_id
            WHERE o.date IN ({dq}) AND o.time != '' AND o.cancelled = 0""", dates):
        slot[(r["date"], r["time"])][r["member_id"]].append(r["id"])
    boats = boats_by_id(conn)
    flag = river.current_flag(rules.settings)
    day_water = defaultdict(list)  # date -> water outings that day (for the before-8am crew limits)
    for r in conn.execute(f"SELECT id, kind, date, time, end_time, capacity FROM outings WHERE kind='water' AND cancelled = 0 AND date IN ({dq})", dates):
        day_water[r["date"]].append(dict(r))
    boat_slot = defaultdict(list)
    for o in conn.execute(f"SELECT id, date, time, boat_id FROM outings WHERE date IN ({dq}) AND boat_id IS NOT NULL AND cancelled = 0", dates):
        boat_slot[(o["date"], o["time"], o["boat_id"])].append(o["id"])
    logs = crewlog.for_outings(conn, outings)
    out = []
    for o in outings:
        p = outing_payload(rules, o, assigns[o["id"]], subs[o["id"]], boats,
                           slot.get((o["date"], o["time"]), {}) if o["time"] else {}, committee)
        crew = {a["seat"]: a["member_id"] for a in assigns[o["id"]]}
        p["river"] = [] if o["cancelled"] else river.check_outing(o, crew, rules.members, boats.get(o["boat_id"]), rules.settings, flag,
                                        rules.today, TZ, [x for x in day_water[o["date"]] if x["id"] != o["id"]])
        if committee and o["boat_id"] and o["time"] and len(boat_slot[(o["date"], o["time"], o["boat_id"])]) > 1:
            p["warnings"].append(f"{boats[o['boat_id']]['name']} is booked twice at this time")
        p["log"] = logs.get(o["id"], [])
        out.append(p)
    return out


def _range_payload(conn, rules: Rules, start: str, end: str, committee: bool) -> list[dict]:
    return outings_payload(conn, rules, "date BETWEEN ? AND ?" + published_only(committee), (start, end), committee)


@router.get("/api/bootstrap")
def bootstrap(role: str = Depends(require_member)):
    committee = role == "committee"
    with db.get_conn() as conn:
        rules = Rules(conn)
        s = rules.settings
        members = [{"id": m["id"], "name": m["name"], "category": m["category"], "cox_status": m["cox_status"],
                    "associate": is_associate(m["college"])}
                   for m in rules.sorted_members(active_only=True)]
        return {
            "role": role,
            "races_closing": closing_soon(conn) if committee else [],
            "expiring": rules.expiring() if committee else [],
            "club_name": s.get("club_name"),
            "today": rules.today.isoformat(),
            "this_week": monday_of(rules.today).isoformat(),
            "members": members,
            "settings": {
                "academic_year": s.get("academic_year"), "current_term": s.get("current_term"),
                "novice_free_outings": rules.free_n,
                "swim_test_valid_months": rules.swim_months, "cox_status_valid_months": rules.cox_months,
                "capsize_drill_valid_months": rules.capsize_months,
            },
        }


@router.get("/api/week")
def week(start: Optional[str] = None, role: str = Depends(require_member)):
    committee = role == "committee"
    with db.get_conn() as conn:
        rules = Rules(conn)
        ws = monday_of(parse_date(start) if start else rules.today)
        days = [ws + timedelta(days=i) for i in range(7)]
        s, e = days[0].isoformat(), days[-1].isoformat()
        counts = conn.execute(
            """SELECT COUNT(*) AS n, SUM(published) AS p FROM
               (SELECT published FROM outings WHERE date BETWEEN ?1 AND ?2 UNION ALL
                SELECT published FROM socials WHERE date BETWEEN ?1 AND ?2)""", (s, e)).fetchone()
        return {
            "start": s,
            "days": [d.isoformat() for d in days],
            "outings": _range_payload(conn, rules, s, e, committee),
            "races": week_races(conn, s, e, committee),
            "socials": week_socials(conn, s, e, committee),
            "total": counts["n"] or 0,
            "published": counts["p"] or 0,
            "today": rules.today.isoformat(),
            "river": {"flag": river.current_flag(rules.settings),
                      "days": {d.isoformat(): river.day_info(d, TZ) for d in days}},
        }


@router.get("/api/month")
def month(month: Optional[str] = None, role: str = Depends(require_member)):
    """A compact overview of one calendar month for the Month tab: whole weeks (Monday to Sunday) covering the
    month, with each day's sessions, races and socials boiled down to what a calendar cell shows."""
    committee = role == "committee"
    with db.get_conn() as conn:
        rules = Rules(conn)
        if month:
            first = to_date(month + "-01")
            if first is None:
                raise HTTPException(400, "Bad month")
        else:
            first = rules.today.replace(day=1)
        last = add_months(first, 1) - timedelta(days=1)
        gs, ge = monday_of(first), monday_of(last) + timedelta(days=6)
        items = defaultdict(list)
        for o in _range_payload(conn, rules, gs.isoformat(), ge.isoformat(), committee):
            items[o["date"]].append({
                "type": "outing", "id": o["id"], "kind": o["kind"], "time": o["time"], "end_time": o["end_time"],
                "title": o["title"], "boat": o["boat"]["name"] if o["boat"] else "", "published": o["published"],
                "cancelled": o["cancelled"], "past": o["past"], "spots": o["spots"], "spots_text": o["spots_text"],
                "cox_check": o["cox_check"], "open_subs": o["open_subs"],
                "members": [s["member"]["id"] for s in o["seats"] if s["member"]],
                "warnings": len(o["warnings"]) if committee else 0})
        for rc in week_races(conn, gs.isoformat(), ge.isoformat(), committee):
            items[rc["date"]].append({
                "type": "race", "id": rc["id"], "title": rc["title"], "time": "", "time_slot": rc["time_slot"],
                "published": rc["published"], "past": rc["date"] < rules.today.isoformat(),
                "members": [s["member_id"] for c in rc["crews"] for s in c["seats"] if s["member_id"] is not None],
                "open_subs": sum(1 for c in rc["crews"] for s in c["seats"] if s["member_id"] is None)})
        for sc in week_socials(conn, gs.isoformat(), ge.isoformat(), committee):
            items[sc["date"]].append({
                "type": "social", "id": sc["id"], "kind": sc["kind"], "title": sc["title"], "time": sc["time"],
                "end_time": sc["end_time"], "published": sc["published"], "past": sc["past"],
                "members": [g["id"] for g in sc["going"]], "going": len(sc["going"])})
        days = []
        d = gs
        while d <= ge:
            day = sorted(items.get(d.isoformat(), []), key=lambda x: (x["time"] or "99:99", x["type"]))
            days.append({"date": d.isoformat(), "in_month": d.month == first.month, "items": day})
            d += timedelta(days=1)
        return {"month": first.strftime("%Y-%m"), "first": first.isoformat(), "days": days,
                "today": rules.today.isoformat(), "this_month": rules.today.strftime("%Y-%m")}
