"""Import members / coaches / settings (and optionally this week's schedule)
from the club's original 'Rowing_Outings.xlsx' spreadsheet."""
from __future__ import annotations

import io
from datetime import date, datetime, timedelta

import openpyxl

from .db import set_setting

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _s(v) -> str:
    return "" if v is None else str(v).strip()


def _i(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _d(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(_s(v)[:10])
    except ValueError:
        return None


def import_workbook(conn, data: bytes, include_schedule: bool = False) -> dict:
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=False)
    report = {"members_added": 0, "members_updated": 0, "coaches": 0, "outings": 0, "settings": 0}

    if "Settings" in wb.sheetnames:
        s = wb["Settings"]
        mapping = {"B3": "academic_year", "B4": "current_term", "B9": "novice_free_outings"}
        for cell, key in mapping.items():
            v = _s(s[cell].value)
            if v:
                set_setting(conn, key, str(_i(v)) if key == "novice_free_outings" else v)
                report["settings"] += 1
        cutoff = _d(s["B5"].value)
        if cutoff:
            set_setting(conn, "subs_cutoff", cutoff.isoformat())
            report["settings"] += 1
        season = _d(s["B10"].value)
        if season:
            set_setting(conn, "season_start", season.replace(day=1).isoformat())
        if _s(s["B11"].value):
            set_setting(conn, "novice_land_free", "1" if _s(s["B11"].value).lower() == "yes" else "0")

    if "Members" in wb.sheetnames:
        m = wb["Members"]
        for r in range(5, m.max_row + 1):
            name = _s(m.cell(r, 1).value)
            if not name:
                continue
            plan = _s(m.cell(r, 3).value) or "Unpaid"
            if plan not in ("Unpaid", "Single term", "Full year"):
                plan = "Unpaid"
            cox = _s(m.cell(r, 17).value).upper()[:1]
            cat = _s(m.cell(r, 18).value) or "Senior"
            row = dict(
                name=name,
                swim_test=1 if _s(m.cell(r, 2).value).lower() == "yes" else 0,
                subs_plan=plan,
                subs_term=_s(m.cell(r, 4).value),
                subs_year=_s(m.cell(r, 5).value),
                past_water=_i(m.cell(r, 10).value),
                past_land=_i(m.cell(r, 11).value),
                cox_status=cox if cox in ("N", "X", "S") else "",
                category="Novice" if cat.lower() == "novice" else "Senior",
            )
            existing = conn.execute("SELECT id FROM members WHERE name = ?", (name,)).fetchone()
            if existing:
                conn.execute(
                    """UPDATE members SET swim_test=:swim_test, subs_plan=:subs_plan, subs_term=:subs_term,
                       subs_year=:subs_year, past_water=:past_water, past_land=:past_land,
                       cox_status=:cox_status, category=:category WHERE id=:id""",
                    {**row, "id": existing["id"]},
                )
                report["members_updated"] += 1
            else:
                conn.execute(
                    """INSERT INTO members(name, swim_test, subs_plan, subs_term, subs_year, past_water,
                       past_land, cox_status, category) VALUES (:name, :swim_test, :subs_plan, :subs_term,
                       :subs_year, :past_water, :past_land, :cox_status, :category)""",
                    row,
                )
                report["members_added"] += 1

    if "Coaches" in wb.sheetnames:
        c = wb["Coaches"]
        for r in range(5, c.max_row + 1):
            name = _s(c.cell(r, 1).value)
            if not name:
                break
            conn.execute(
                "INSERT INTO coaches(name, search_text) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET search_text = excluded.search_text",
                (name, _s(c.cell(r, 2).value)),
            )
            report["coaches"] += 1

    if include_schedule and "Schedule" in wb.sheetnames and "Settings" in wb.sheetnames:
        week = _d(wb["Settings"]["B8"].value)
        if week:
            report["outings"] = _import_schedule(conn, wb["Schedule"], week)
    return report


def _t(v) -> tuple[str, str]:
    """Spreadsheet time cell -> ("HH:MM", end "HH:MM" or "")."""
    from datetime import time as _time
    from .timeutil import normalize
    if isinstance(v, (datetime, _time)):
        return (v.strftime("%H:%M"), "")
    return normalize(_s(v))


def _member_id(conn, name: str):
    r = conn.execute("SELECT id FROM members WHERE name = ?", (name,)).fetchone()
    return r["id"] if r else None


def _import_schedule(conn, sh, week: date) -> int:
    n = 0
    seat_rows = {8: 0, 9: 8, 10: 7, 11: 6, 12: 5, 13: 4, 14: 3, 15: 2, 16: 1}
    for col in range(2, 12):
        # water block
        day = _s(sh.cell(2, col).value)
        if day in DAYS:
            cap = _i(sh.cell(17, col).value) or 8
            d = week + timedelta(days=DAYS.index(day))
            cur = conn.execute(
                "INSERT INTO outings(kind, date, time, end_time, location, title, coach, capacity, coxed, published) VALUES ('water', ?, ?, ?, ?, ?, ?, ?, 1, 1)",
                (d.isoformat(), *_t(sh.cell(5, col).value), _s(sh.cell(4, col).value),
                 _s(sh.cell(6, col).value), _s(sh.cell(7, col).value), cap),
            )
            oid, used = cur.lastrowid, set()
            # rows 9..16 are S,7..B for an eight; a four uses the bottom 4 rows (4,3,2,B)
            for row, seat in seat_rows.items():
                name = _s(sh.cell(row, col).value)
                mid = _member_id(conn, name) if name else None
                if not mid or mid in used or (seat and seat > cap):
                    continue
                conn.execute("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?, ?, ?)", (oid, seat, mid))
                used.add(mid)
            n += 1
        # land block
        day = _s(sh.cell(21, col).value)
        if day in DAYS:
            d = week + timedelta(days=DAYS.index(day))
            cur = conn.execute(
                "INSERT INTO outings(kind, date, time, end_time, location, title, coach, capacity, coxed, published) VALUES ('land', ?, ?, ?, ?, 'Land training', ?, 8, 0, 1)",
                (d.isoformat(), *_t(sh.cell(24, col).value), _s(sh.cell(23, col).value), _s(sh.cell(25, col).value)),
            )
            oid, used, seat = cur.lastrowid, set(), 1
            for row in range(26, 34):
                name = _s(sh.cell(row, col).value)
                mid = _member_id(conn, name) if name else None
                if mid and mid not in used:
                    conn.execute("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?, ?, ?)", (oid, seat, mid))
                    used.add(mid)
                    seat += 1
            n += 1
    return n
