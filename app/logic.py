"""Club rules: eligibility, outing counts, schedule checks.

Rules follow the club's original spreadsheet:
  * Subs are valid if the member has a Full-year plan for the current academic year,
    or a Single-term plan for the current term + year.
  * Anyone may row (subs-wise) up to and including the subs cutoff date.
  * Swim test: nobody needs one for their first `swim_test_after` water outings
    (default 4); from the next water outing on it's required. Land never needs one.
  * A NOVICE who hasn't paid subs gets N free water outings (default 4) that don't need
    subs. Once their subs are paid the allowance no longer applies. While they still have
    free water outings left, land training is also free (configurable).
  * Cox seats count as water outings.
  * A novice cox (status N) needs a bankrider/coach.
"""
from __future__ import annotations

import bisect
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .db import get_settings

TZ = ZoneInfo(os.environ.get("TZ_NAME", os.environ.get("TZ", "Europe/London")) or "Europe/London")
TERMS = ["Michaelmas", "Hilary", "Trinity"]
SUBS_PLANS = ["Unpaid", "Single term", "Full year"]
# Why a session was cancelled (outings.cancel_category). Order = order shown in the app.
CANCEL_REASONS = {
    "flag": "Red flag",
    "weather": "Weather",
    "bankrider": "No bankrider",
    "numbers": "Too few people",
    "other": "Other",
}


def outing_status(o: dict, today: date) -> str:
    """scheduled (still to come) | past (went ahead) | cancelled."""
    if o.get("cancelled"):
        return "cancelled"
    return "past" if o["date"] < today.isoformat() else "scheduled"
BOAT_TYPES = {  # type -> (rowers, coxed)
    "8+": (8, 1), "4+": (4, 1), "4-": (4, 0), "4x": (4, 0), "4x+": (4, 1),
    "2x": (2, 0), "2-": (2, 0), "1x": (1, 0), "Other": (8, 1),
}


def real_today() -> date:
    return datetime.now(TZ).date()


def effective_today(settings: dict) -> date:
    ov = (settings.get("today_override") or "").strip()
    if ov:
        try:
            return date.fromisoformat(ov)
        except ValueError:
            pass
    return real_today()


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def seat_label(seat: int, capacity: int, kind: str) -> str:
    if kind == "land":
        return str(seat)
    if seat == 0:
        return "Cox"
    if capacity == 1:
        return "Sculler"
    if seat == capacity:
        return "Stroke"
    if seat == 1:
        return "Bow"
    return str(seat)


def seat_list(kind: str, capacity: int, coxed: bool) -> list[int]:
    """Seats in display order: cox, stroke ... bow (water); 1..n (land)."""
    if kind == "land":
        return list(range(1, capacity + 1))
    seats = list(range(capacity, 0, -1))
    return ([0] if coxed else []) + seats


class Rules:
    """Loads everything once per request and answers eligibility questions."""

    def __init__(self, conn):
        self.conn = conn
        self.settings = get_settings(conn)
        self.today = effective_today(self.settings)
        try:
            self.free_n = max(0, int(self.settings.get("novice_free_outings") or 0))
        except ValueError:
            self.free_n = 4
        try:
            self.swim_after = max(0, int(self.settings.get("swim_test_after") or 0))
        except ValueError:
            self.swim_after = 4
        self.land_free = self.settings.get("novice_land_free") == "1"
        self.cutoff = None
        if self.settings.get("subs_cutoff"):
            try:
                self.cutoff = date.fromisoformat(self.settings["subs_cutoff"])
            except ValueError:
                pass
        self.members = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM members")}
        self.places = {r["name"].lower(): dict(r) for r in conn.execute("SELECT * FROM places")}
        rows = conn.execute(
            """SELECT a.id, a.outing_id, a.seat, a.member_id, o.kind, o.date, o.time
               FROM assignments a JOIN outings o ON o.id = a.outing_id
               WHERE o.cancelled = 0
               ORDER BY o.date, o.time, o.id"""
        ).fetchall()
        # per member: sorted list of water outing sort keys; counts
        self.water_keys: dict[int, list] = defaultdict(list)
        self.counts = defaultdict(lambda: {"water": 0, "land": 0, "water_done": 0, "land_done": 0})
        today_s = self.today.isoformat()
        for r in rows:
            key = (r["date"], r["time"], r["outing_id"])
            c = self.counts[r["member_id"]]
            c[r["kind"]] += 1
            if r["date"] < today_s:
                c[r["kind"] + "_done"] += 1
            if r["kind"] == "water":
                self.water_keys[r["member_id"]].append(key)

    # ---- subs -------------------------------------------------------------
    def subs_valid(self, m: dict) -> bool:
        ay, term = self.settings.get("academic_year", ""), self.settings.get("current_term", "")
        if m["subs_plan"] == "Full year":
            return m["subs_year"].strip() == ay
        if m["subs_plan"] == "Single term":
            return m["subs_year"].strip() == ay and m["subs_term"] == term
        return False

    def subs_ok_on(self, m: dict, d: date) -> bool:
        return self.subs_valid(m) or (self.cutoff is not None and d <= self.cutoff)

    # ---- counts -----------------------------------------------------------
    def water_before(self, member_id: int, key) -> int:
        """Water outings (baseline + scheduled) strictly before outing `key`."""
        m = self.members.get(member_id)
        base = m["past_water"] if m else 0
        return base + bisect.bisect_left(self.water_keys.get(member_id, []), key)

    def totals(self, member_id: int) -> dict:
        m = self.members[member_id]
        c = self.counts[member_id]
        water = m["past_water"] + c["water"]
        land = m["past_land"] + c["land"]
        return {
            "water": water, "land": land, "total": water + land,
            "water_done": m["past_water"] + c["water_done"],
            "land_done": m["past_land"] + c["land_done"],
            "upcoming": (c["water"] - c["water_done"]) + (c["land"] - c["land_done"]),
            # only relevant while subs are unpaid
            "novice_free_left": (max(0, self.free_n - water)
                                 if m["category"] == "Novice" and not self.subs_valid(m) else None),
        }

    # ---- eligibility ------------------------------------------------------
    def check(self, member_id: int, kind: str, d: date, key, before: int | None = None) -> dict:
        """Eligibility of a member for an outing of `kind` on date `d` (sort key `key`).

        `before` overrides the number of water outings counted before this one (used by
        auto-fill to account for seats it has planned but not saved yet)."""
        m = self.members.get(member_id)
        if not m:
            return {"ok": False, "reasons": ["Not in members list"], "note": ""}
        reasons, note = [], ""
        # The novice allowance only matters while subs are unpaid.
        novice = m["category"] == "Novice" and not self.subs_valid(m)
        if before is None:
            before = self.water_before(member_id, key)
        if kind == "water":
            nth = before + 1
            free_subs = novice and nth <= self.free_n
            if not m["swim_test"] and nth > self.swim_after:
                reasons.append("No swim test")
            if not free_subs and not self.subs_ok_on(m, d):
                reasons.append("Subs not paid")
            if not reasons:
                if free_subs:
                    note = f"Novice free outing {nth} of {self.free_n}"
                elif not m["swim_test"]:
                    note = f"Outing {nth} of {self.swim_after} before a swim test is needed"
                elif not self.subs_valid(m):
                    note = "Before subs cutoff"
            return {"ok": not reasons, "reasons": reasons, "note": note}
        else:
            if self.land_free and novice and before < self.free_n:
                return {"ok": True, "reasons": [], "note": "Novice: land free while free water outings remain"}
            if not self.subs_ok_on(m, d):
                reasons.append("Subs not paid")
        if not reasons and not self.subs_valid(m):
            note = "Before subs cutoff"
        return {"ok": not reasons, "reasons": reasons, "note": note}

    def status_now(self, member_id: int) -> dict:
        """'May row' at the member's NEXT new outing: counts every outing already done or
        scheduled, so it agrees with what the schedule shows for their upcoming sessions."""
        m = self.members[member_id]
        key = ("9999-12-31", "", 0)  # a hypothetical outing after everything already scheduled
        water = self.check(member_id, "water", self.today, key)
        land = self.check(member_id, "land", self.today, key)
        return {"subs_valid": self.subs_valid(m), "water": water, "land": land}


def maps_url(place) -> str:
    """Link that opens the place in the phone's maps app (Google Maps URL works everywhere)."""
    if not place:
        return ""
    from urllib.parse import quote
    if place.get("lat") is not None and place.get("lon") is not None:
        return f"https://www.google.com/maps/search/?api=1&query={place['lat']:.6f},{place['lon']:.6f}"
    if place.get("address"):
        return "https://www.google.com/maps/search/?api=1&query=" + quote(f"{place['name']}, {place['address']}")
    return ""


def outing_payload(rules: Rules, o: dict, assignments: list[dict], subs: list[dict],
                   boats: dict, same_slot: dict, committee: bool) -> dict:
    """Serialise one outing with seats, eligibility flags and warnings."""
    kind, cap, coxed = o["kind"], o["capacity"], bool(o["coxed"]) and o["kind"] == "water"
    d = date.fromisoformat(o["date"])
    key = (o["date"], o["time"], o["id"])
    by_seat = {a["seat"]: a for a in assignments}
    open_subs = {s["seat"]: s for s in subs if s["status"] == "open"}
    filled_subs = {s["seat"]: s for s in subs if s["status"] == "filled"}
    seats, warnings = [], []
    ineligible = 0
    for s in seat_list(kind, cap, coxed):
        a = by_seat.get(s)
        entry = {"seat": s, "label": seat_label(s, cap, kind), "member": None}
        if a:
            m = rules.members.get(a["member_id"], {})
            elig = rules.check(a["member_id"], kind, d, key)
            if not elig["ok"]:
                ineligible += 1
            entry["member"] = {
                "id": a["member_id"], "name": m.get("name", "?"),
                "category": m.get("category"), "cox_status": m.get("cox_status"),
            }
            if committee:  # payment / swim-test status is committee-only information
                entry["eligibility"] = elig
            if s in open_subs:
                sr = open_subs[s]
                entry["sub_request"] = {"id": sr["id"], "reason": sr["reason"]}
            if s in filled_subs:
                sr = filled_subs[s]
                req = rules.members.get(sr["requester_id"], {})
                if sr["sub_id"] == a["member_id"]:
                    entry["subbed_for"] = req.get("name")
            conflicts = [] if o.get("cancelled") else [x for x in same_slot.get(a["member_id"], []) if x != o["id"]]
            if conflicts:
                warnings.append(f"{m.get('name')} is double-booked at this time")
        seats.append(entry)

    rowers = [x for x in seats if x["seat"] != 0]
    empty_rowers = sum(1 for x in rowers if not x["member"])
    cox_seat = next((x for x in seats if x["seat"] == 0), None)
    cox_check = ""
    if kind == "water" and coxed:
        if not cox_seat["member"]:
            cox_check = "Cox needed"
        else:
            cs = cox_seat["member"]["cox_status"]
            if cs == "N":
                cox_check = "Novice cox · bankrider set" if o["coach"].strip() else "Bankrider needed"
            elif cs in ("X", "S"):
                cox_check = "Experienced cox" if cs == "X" else "Senior cox"
            else:
                cox_check = "Cox status not set"
    if cox_check == "Bankrider needed":
        warnings.append("Novice cox: bankrider/coach needed")
    if o.get("cancelled"):
        warnings = []  # nothing to fix on a cancelled session
    if ineligible and committee and not o.get("cancelled"):
        warnings.append(f"{ineligible} ineligible athlete{'s' if ineligible > 1 else ''}")
    boat = boats.get(o["boat_id"]) if o["boat_id"] else None
    if boat and boat["status"] != "available" and committee and not o.get("cancelled"):
        warnings.append(f"{boat['name']} is marked '{boat['status']}'")
    spots = empty_rowers + (1 if cox_seat and not cox_seat["member"] else 0)
    if kind == "land":  # land sessions are open: anyone can take a free spot
        spots_text = "Full" if empty_rowers == 0 else f"{empty_rowers} spot{'' if empty_rowers == 1 else 's'} open"
    elif empty_rowers == 0:
        spots_text = "Cox needed" if (cox_seat and not cox_seat["member"]) else "Full"
    else:
        spots_text = f"{empty_rowers} {'rower' if empty_rowers == 1 else 'rowers'}" + (
            " + cox" if cox_seat and not cox_seat["member"] else "") + " needed"
    return {
        "id": o["id"], "kind": kind, "date": o["date"], "time": o["time"], "end_time": o["end_time"],
        "location": o["location"], "maps_url": maps_url(rules.places.get((o["location"] or "").strip().lower())), "title": o["title"], "coach": o["coach"],
        "boat": ({"id": boat["id"], "name": boat["name"], "type": boat["boat_type"],
                  "status": boat["status"]} if boat else None),
        "capacity": cap, "coxed": coxed, "published": bool(o["published"]),
        "notes": o["notes"], "seats": seats, "spots": spots, "spots_text": spots_text,
        "cox_check": cox_check, "warnings": warnings,
        "past": d < rules.today,
        "cancelled": bool(o.get("cancelled")), "cancel_reason": o.get("cancel_reason") or "",
        "cancel_category": o.get("cancel_category") or "",
        "cancel_label": CANCEL_REASONS.get(o.get("cancel_category") or "", ""),
        "status": outing_status(o, rules.today),
        "open_subs": len(open_subs),
    }
