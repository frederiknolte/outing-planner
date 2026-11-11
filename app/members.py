"""Members: rower profiles and outing counts, the committee's members list, subs reminders, phone numbers and coaches."""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import crewlog, db, privacy
from .auth import require_committee, require_member
from .common import optional_date, unique_name
from .logic import SUBS_PLANS, TERMS, Rules, add_months, effective_today, real_today, season_start
from .races import member_races
from .schedule import outings_payload
from .signup import SIDES, SQUADS

router = APIRouter()

CLUB_CREWS = ("M1", "M2", "W1", "W2")      # committee-assigned crews; committee-only information


# --------------------------------------------------------------- helpers ----
def _phone_value(phone: Optional[str]) -> Optional[str]:
    """Encrypted value to store, '' to delete, None to keep unchanged."""
    if phone is None:
        return None
    phone = phone.strip()
    if not phone:
        return ""
    if sum(c.isdigit() for c in phone) < 7:
        raise HTTPException(400, "That phone number looks too short")
    if not privacy.enabled():
        raise HTTPException(400, "Phone numbers can't be stored: set the PHONE_KEY environment variable first")
    return privacy.encrypt(phone)


def _set_phone(conn, member_id: int, value: Optional[str]) -> None:
    """Store a value from _phone_value (None leaves the number as it is)."""
    if value is not None:
        conn.execute("UPDATE members SET phone = ?, phone_updated_at = CASE WHEN ? != '' THEN datetime('now') ELSE '' END WHERE id = ?",
                     (value, value, member_id))


def _check_squad(squad: str) -> None:
    if squad and squad not in SQUADS:
        raise HTTPException(400, "Bad squad")


def _coaches(conn) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT id, name FROM members WHERE category = 'Coach' ORDER BY name")]


# --------------------------------------------------------- rower side ----
@router.get("/api/members/{member_id}/summary")
def member_summary(member_id: int, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        m = rules.members.get(member_id)
        if not m:
            raise HTTPException(404, "Unknown member")
        ids = [r["outing_id"] for r in conn.execute(
            "SELECT a.outing_id FROM assignments a JOIN outings o ON o.id=a.outing_id WHERE a.member_id=? AND o.date >= ? AND o.published=1",
            (member_id, rules.today.isoformat()))]
        upcoming = []
        if ids:
            qs = ",".join("?" * len(ids))
            upcoming = outings_payload(conn, rules, f"id IN ({qs})", tuple(ids), role == "committee")
        return {
            "member": {"id": m["id"], "name": m["name"], "category": m["category"], "cox_status": m["cox_status"]},
            "totals": rules.totals(member_id),
            "status": rules.status_fields(m),
            "upcoming": upcoming,
            "races": member_races(conn, member_id, rules.today.isoformat()),
        }


class ProfileIn(BaseModel):
    """What a rower may change about themselves."""
    side: str = Field("", max_length=40)
    college: str = Field("", max_length=80)
    phone: Optional[str] = Field(None, max_length=40)   # None = keep, "" = delete
    squad: str = ""                                      # '' | open | women


@router.get("/api/members/{member_id}/profile")
def member_profile(member_id: int, _: str = Depends(require_member)):
    with db.get_conn() as conn:
        m = conn.execute("SELECT side, college, squad, phone FROM members WHERE id = ?", (member_id,)).fetchone()
        if not m:
            raise HTTPException(404, "Unknown member")
        return {"side": m["side"], "college": m["college"], "squad": m["squad"] or "",
                "has_phone": bool(m["phone"]), "phone_masked": privacy.mask(m["phone"])}


@router.put("/api/members/{member_id}/profile")
def member_profile_update(member_id: int, b: ProfileIn, _: str = Depends(require_member)):
    if b.side and b.side not in SIDES:
        raise HTTPException(400, "Bad side preference")
    _check_squad(b.squad)
    new_phone = _phone_value(b.phone)
    with db.get_conn() as conn:
        if not conn.execute("SELECT 1 FROM members WHERE id = ?", (member_id,)).fetchone():
            raise HTTPException(404, "Unknown member")
        conn.execute("UPDATE members SET side=?, college=?, squad=? WHERE id=?",
                     (b.side, b.college.strip(), b.squad, member_id))
        _set_phone(conn, member_id, new_phone)
        return {"ok": True}


@router.get("/api/rowers")
def rowers(role: str = Depends(require_member)):
    """Outing counts for everyone (visible to all signed-in users; free novice outings left are committee-only)."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        out = []
        for m in rules.sorted_members(active_only=True):
            t = rules.totals(m["id"])
            if role != "committee":
                t.pop("novice_free_left")   # how many free outings someone has left is committee-only
            out.append({"id": m["id"], "name": m["name"], "category": m["category"],
                        "cox_status": m["cox_status"], "squad": m["squad"] or "", **t})
        return out


# ------------------------------------------------------------ committee ----
class MemberIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    category: str = "Novice"
    swim_test: bool = False
    subs_plan: str = "Unpaid"
    subs_term: str = ""
    subs_year: str = ""
    cox_status: str = ""
    swim_test_date: str = ""                             # YYYY-MM-DD passed, or ''
    cox_status_date: str = ""                            # YYYY-MM-DD awarded, or ''
    capsize_drilled: bool = False
    capsize_drill_date: str = ""                         # YYYY-MM-DD of the drill, or ''
    past_water: int = Field(0, ge=0)
    past_land: int = Field(0, ge=0)
    active: bool = True
    notes: str = Field("", max_length=500)
    phone: Optional[str] = Field(None, max_length=40)   # None = keep the stored number, "" = delete it
    college: str = Field("", max_length=80)
    side: str = Field("", max_length=40)
    squad: str = ""                                      # '' | open | women (race eligibility)
    club_crew: str = ""                                  # comma-separated subset of M1,M2,W1,W2, e.g. "M1,M2" (committee-only)


# Qualification dates: field, the flag it implies, and its name in messages.
_QUAL_DATES = (("swim_test_date", "swim_test", "swim test"), ("cox_status_date", "cox_status", "cox status"),
               ("capsize_drill_date", "capsize_drilled", "capsize drill"))


def _member_validate(m: MemberIn):
    if m.category not in ("Novice", "Senior", "Coach"):
        raise HTTPException(400, "Category must be Novice, Senior or Coach")
    if m.category == "Coach":
        m.active = False   # coaches are always stored as inactive, which keeps them out of the rower logic
    if m.subs_plan not in SUBS_PLANS:
        raise HTTPException(400, "Bad subs plan")
    if m.cox_status not in ("", "N", "X", "S"):
        raise HTTPException(400, "Bad cox status")
    _check_squad(m.squad)
    picked = [c.strip() for c in m.club_crew.split(",") if c.strip()]
    if any(c not in CLUB_CREWS for c in picked):
        raise HTTPException(400, "Bad crew")
    m.club_crew = ",".join(c for c in CLUB_CREWS if c in picked)   # canonical order, no duplicates
    for field, flag, label in _QUAL_DATES:
        v = optional_date(getattr(m, field), f"Bad {label} date")
        if v > real_today().isoformat():
            raise HTTPException(400, f"The {label} date is in the future")
        if v and flag != "cox_status":       # a dated swim test or capsize drill counts as done
            setattr(m, flag, True)
        setattr(m, field, v if getattr(m, flag) else "")


def _member_fields(m: MemberIn) -> tuple:
    return (m.name.strip(), m.category, int(m.swim_test), m.subs_plan, m.subs_term, m.subs_year.strip(), m.cox_status,
            m.past_water, m.past_land, int(m.active), m.notes, m.college.strip(), m.side, m.squad, m.club_crew,
            m.swim_test_date, m.cox_status_date, int(m.capsize_drilled), m.capsize_drill_date)


_MEMBER_COLUMNS = ("name", "category", "swim_test", "subs_plan", "subs_term", "subs_year", "cox_status", "past_water", "past_land",
                   "active", "notes", "college", "side", "squad", "club_crew", "swim_test_date", "cox_status_date",
                   "capsize_drilled", "capsize_drill_date")


@router.get("/api/committee/members")
def members_list(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        out = []
        for m in rules.sorted_members():
            safe = {k: v for k, v in m.items() if k not in ("phone", "cal_token")}
            out.append({**safe, "has_phone": bool(m["phone"]), "phone_masked": privacy.mask(m["phone"]),
                        "active": bool(m["active"]), "totals": rules.totals(m["id"]), **rules.status_fields(m)})
        return {"members": out, "terms": TERMS, "plans": SUBS_PLANS, "crews": list(CLUB_CREWS)}


@router.post("/api/committee/members")
def member_create(m: MemberIn, _: str = Depends(require_committee)):
    _member_validate(m)
    phone = _phone_value(m.phone)
    with db.get_conn() as conn, unique_name("member"):
        cur = conn.execute(f"INSERT INTO members({', '.join(_MEMBER_COLUMNS)}) VALUES ({', '.join('?' * len(_MEMBER_COLUMNS))})",
                           _member_fields(m))
        _set_phone(conn, cur.lastrowid, phone or None)
        return {"id": cur.lastrowid}


@router.put("/api/committee/members/{member_id}")
def member_update(member_id: int, m: MemberIn, _: str = Depends(require_committee)):
    _member_validate(m)
    with db.get_conn() as conn, unique_name("member"):
        conn.execute(f"UPDATE members SET {', '.join(c + '=?' for c in _MEMBER_COLUMNS)}, needs_review=0 WHERE id=?",
                     _member_fields(m) + (member_id,))
        _set_phone(conn, member_id, _phone_value(m.phone))
        return {"ok": True}


@router.delete("/api/committee/members/{member_id}")
def member_delete(member_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        land = [r["outing_id"] for r in conn.execute(
            "SELECT a.outing_id FROM assignments a JOIN outings o ON o.id = a.outing_id WHERE a.member_id = ? AND o.kind = 'land'",
            (member_id,))]
        conn.execute("DELETE FROM members WHERE id=?", (member_id,))
        for oid in land:   # the rest of each land list moves up
            crewlog.compact_land(conn, oid)
        return {"ok": True}


# ---------------------------------------------------------- subs reminders ----
@router.get("/api/committee/subs-reminders")
def subs_reminders(_: str = Depends(require_committee)):
    """Unpaid active members who need reminding, most urgent first.

    Tiers: blocked (scheduled in sessions they can't do because subs aren't paid) ->
    now (free outings used / senior after the cutoff) -> cutoff (same, but the cutoff
    hasn't passed yet) -> soon (novice with 1 free outing left). Counts include outings
    already scheduled.
    """
    with db.get_conn() as conn:
        rules = Rules(conn)
        today = rules.today.isoformat()
        before_cutoff = rules.cutoff is not None and rules.today <= rules.cutoff
        blocked, upcoming = defaultdict(list), defaultdict(list)
        for r in conn.execute(
                """SELECT a.member_id, o.id, o.kind, o.date, o.time, o.title FROM assignments a
                   JOIN outings o ON o.id = a.outing_id WHERE o.date >= ? AND o.cancelled = 0 ORDER BY o.date, o.time, o.id""", (today,)):
            info = {"id": r["id"], "kind": r["kind"], "date": r["date"], "time": r["time"], "title": r["title"]}
            upcoming[r["member_id"]].append(info)
            e = rules.check(r["member_id"], r["kind"], date.fromisoformat(r["date"]), (r["date"], r["time"], r["id"]))
            if "Subs not paid" in e["reasons"]:
                blocked[r["member_id"]].append(info)
        last_out = {r["member_id"]: r["d"] for r in conn.execute(
            "SELECT a.member_id, MAX(o.date) d FROM assignments a JOIN outings o ON o.id = a.outing_id WHERE o.date <= ? AND o.cancelled = 0 GROUP BY a.member_id", (today,))}
        last_signup = {r["member_id"]: r["w"] for r in conn.execute("SELECT member_id, MAX(week_start) w FROM signups GROUP BY member_id")}
        order = {"blocked": 0, "now": 1, "cutoff": 2, "soon": 3}
        out = []
        for mid, m in rules.members.items():
            if not m["active"] or rules.subs_valid(m):
                continue
            t = rules.totals(mid)
            novice = m["category"] == "Novice"
            free_left = max(0, rules.free_n - t["water"]) if novice else None
            # date of the water outing that reaches the free limit (None if reached before this system)
            reach_date = None
            if novice and rules.free_n:
                idx = rules.free_n - m["past_water"] - 1
                keys = rules.water_keys.get(mid, [])
                if 0 <= idx < len(keys):
                    reach_date = keys[idx][0]
            if blocked[mid]:
                tier = "blocked"
            elif novice and free_left > 1:
                continue
            elif not novice or free_left == 0:
                tier = "cutoff" if before_cutoff else "now"
            else:
                tier = "soon"
            out.append({
                "id": mid, "name": m["name"], "category": m["category"], "tier": tier,
                "free_left": free_left, "free_n": rules.free_n, "water": t["water"], "land": t["land"],
                "water_done": t["water_done"], "reach_date": reach_date,
                "blocked": blocked[mid][:5], "next": (upcoming[mid] or [None])[0],
                "last_activity": max(filter(None, [last_out.get(mid), last_signup.get(mid)]), default=None),
                "subs_plan": m["subs_plan"], "subs_term": m["subs_term"], "subs_year": m["subs_year"],
                "has_phone": bool(m["phone"]), "phone_masked": privacy.mask(m["phone"]),
                "reminded_at": m["subs_reminded_at"] or None,
            })
        out.sort(key=lambda x: (order[x["tier"]], bool(x["reminded_at"]), x["next"]["date"] if x["next"] else "9999",
                                -(int((x["last_activity"] or "0000-00-00").replace("-", "")))))
        s = rules.settings
        return {"members": out, "term": s.get("current_term"), "year": s.get("academic_year"),
                "cutoff": s.get("subs_cutoff") or None, "before_cutoff": before_cutoff, "today": today,
                "club": s.get("club_name"), "free_n": rules.free_n,
                "template": s.get("subs_reminder_template") or db.DEFAULT_SETTINGS["subs_reminder_template"],
                "default_template": db.DEFAULT_SETTINGS["subs_reminder_template"]}


class TemplateIn(BaseModel):
    template: str = Field(..., max_length=2000)


@router.put("/api/committee/subs-reminders/template")
def subs_template(b: TemplateIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        db.set_setting(conn, "subs_reminder_template", b.template.strip() or db.DEFAULT_SETTINGS["subs_reminder_template"])
        return {"ok": True}


class RemindedIn(BaseModel):
    reminded: bool = True


@router.post("/api/committee/members/{member_id}/reminded")
def member_reminded(member_id: int, b: RemindedIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("UPDATE members SET subs_reminded_at = CASE WHEN ? THEN datetime('now') ELSE '' END WHERE id = ?",
                     (int(b.reminded), member_id))
        return {"ok": True}


class PaidIn(BaseModel):
    plan: str  # "Single term" (current term) | "Full year" (current academic year)


@router.post("/api/committee/members/{member_id}/paid")
def member_paid(member_id: int, b: PaidIn, _: str = Depends(require_committee)):
    if b.plan not in ("Single term", "Full year"):
        raise HTTPException(400, "Plan must be Single term or Full year")
    with db.get_conn() as conn:
        s = db.get_settings(conn)
        conn.execute("""UPDATE members SET subs_plan = ?, subs_term = ?, subs_year = ?, subs_reminded_at = ''
                        WHERE id = ?""",
                     (b.plan, s.get("current_term", "") if b.plan == "Single term" else "", s.get("academic_year", ""), member_id))
        return {"ok": True}


# ---------------------------------------------------------------- phones ----
@router.get("/api/committee/members/{member_id}/phone")
def member_phone(member_id: int, _: str = Depends(require_committee)):
    """Reveal one member's full number (committee taps "Show")."""
    with db.get_conn() as conn:
        r = conn.execute("SELECT phone FROM members WHERE id = ?", (member_id,)).fetchone()
        if not r:
            raise HTTPException(404, "Unknown member")
        plain = privacy.decrypt(r["phone"])
        if plain is None:
            raise HTTPException(409, "This number can't be read: PHONE_KEY is missing or has changed")
        return {"phone": plain}


@router.delete("/api/committee/members/{member_id}/phone")
def member_phone_delete(member_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        _set_phone(conn, member_id, "")
        return {"ok": True}


@router.get("/api/committee/members.csv")
def members_csv(include_phone: bool = False, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        buf = io.StringIO()
        w = csv.writer(buf)
        yes = lambda v: "Yes" if v else "No"  # noqa: E731
        w.writerow(["Name"] + (["Phone"] if include_phone else []) + ["College", "Side", "Squad", "Crew", "Category", "Swim test", "Swim test date", "Swim test expires", "Subs plan", "Term", "Year",
                    "Subs valid", "Cox status", "Cox status date", "Cox status expires", "Capsize drilled", "Capsize drill date", "Capsize drill expires",
                    "Water outings", "Land sessions", "Total", "Novice free left", "Active"])
        for m in rules.sorted_members():
            t = rules.totals(m["id"])
            w.writerow([m["name"]] + ([privacy.decrypt(m["phone"]) or ""] if include_phone else []) + [
                m["college"], m["side"], m["squad"], m["club_crew"], m["category"],
                yes(m["swim_test"]), m["swim_test_date"], rules.swim_expiry(m)["expires"], m["subs_plan"], m["subs_term"], m["subs_year"],
                yes(rules.subs_valid(m)), m["cox_status"], m["cox_status_date"], rules.cox_expiry(m)["expires"],
                yes(m["capsize_drilled"]), m["capsize_drill_date"], rules.capsize_expiry(m)["expires"],
                t["water"], t["land"], t["total"], "" if t["novice_free_left"] is None else t["novice_free_left"], yes(m["active"])])
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=members.csv"})


# -------------------------------------------------------------- coaches ----
# Coaches are members with category Coach (set on the Members page); this lists them for the Coaches page and name pickers.
@router.get("/api/committee/coaches")
def coaches_list(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        return _coaches(conn)


@router.get("/api/committee/coaching-stats")
def coaching_stats(_: str = Depends(require_committee)):
    """Sessions per coach per month over 12 months from the season start (substring match, like the sheet)."""
    with db.get_conn() as conn:
        s = db.get_settings(conn)
        start = season_start(s, effective_today(s)).replace(day=1)
        months = [add_months(start, i).strftime("%Y-%m") for i in range(12)]
        outings = conn.execute("SELECT date, coach FROM outings WHERE coach != '' AND cancelled = 0 AND date >= ? AND date < ?",
                               (start.isoformat(), add_months(start, 12).isoformat())).fetchall()
        rows, uncounted = [], defaultdict(int)
        counted_any = [False] * len(outings)
        for c in _coaches(conn):
            key = c["name"].lower()
            per = {m: 0 for m in months}
            for i, o in enumerate(outings):
                if key and key in o["coach"].lower():
                    per[o["date"][:7]] += 1
                    counted_any[i] = True
            rows.append({"name": c["name"], "months": per, "total": sum(per.values())})
        for i, o in enumerate(outings):
            if not counted_any[i]:
                uncounted[o["coach"]] += 1
        return {"months": months, "rows": rows,
                "uncounted": [{"coach": k, "n": v} for k, v in sorted(uncounted.items())]}
