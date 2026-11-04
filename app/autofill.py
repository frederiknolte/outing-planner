"""Auto-fill the week's water crews from the weekly sign-up.

The committee creates the week's water outings (by hand, from sign-up slots, or by
copying last week), then **Auto-fill crews** proposes who sits where. Nothing is saved
until the committee applies the proposal, and then only *empty* seats are filled: anyone
already placed stays put. Sessions stay drafts, so the committee adjusts by hand and
publishes as usual.

Who can be placed in an outing (hard rules):
  * signed up for the week and ticked a sign-up session matching the outing's day and
    time (the same matching as the editor's "Signed up" panel);
  * eligible for that outing (subs, swim test, novice free outings: `Rules.check`),
    counting the outings auto-fill has already planned for them. A seat is also refused
    if it would make one of their *later* outings ineligible (e.g. use up a novice's
    last free outing before a session they're already in);
  * not already at the weekly maximum they gave (rowing, coxing, land and bankriding
    all count);
  * not in another session at an overlapping time, and at most one water seat a day;
  * cox seat: signed up as cox (or rower & cox) and has a cox status;
  * rowing seats: signed up as rower (or rower & cox);
  * sweep boats: "Bow side only" rowers only go in bow-side (odd) seats and "Stroke side
    only" rowers in stroke-side (even) seats.

How it chooses (soft preferences, in order):
  * fairness first: people furthest below the number of rowing (or coxing) outings they
    asked for come first; someone is only given more than they asked for (up to their
    maximum) when a boat would otherwise be short;
  * then side preference ("... preferred"), keeping both sides of the boat balanced;
  * then people with fewer other sessions they could do this week, so flexible people
    don't take the only slot someone else is free for;
  * remaining ties are broken by a shuffle seeded with the week, so the same people
    don't always win.
  * squads: senior crews are kept to one squad (Open or Women's, from the crew already
    placed, the crew name such as "W1", or whoever signed up), but rowers from the other
    squad are added rather than leaving seats empty: a full boat beats a split one. For
    novice crews the squad hardly matters and is only a late tie-break;
  * Novice boats get 2, ideally 3, seniors in an 8 (scaled down for smaller boats), and
    no more unless the boat can't be filled otherwise. Seniors with the fewest novice
    outings that week go first, so novice duty is shared out.
  * Coxes: experienced/senior coxes are preferred when the outing has no coach or
    bankrider; a novice cox can still be placed and then gets a bankrider if possible.

Order: the hardest outings to fill (fewest candidates per empty seat) are planned first.
Outings that can be filled completely are filled before any partial crews, so people
aren't used up on a boat that can't go out anyway. Afterwards, outings with an empty
coach/bankrider field get someone who said they can bankride and is free then (outings
with a novice cox first).
"""
from __future__ import annotations

import bisect
import random
import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, push
from .auth import require_committee
from .logic import Rules, monday_of, seat_label, seat_list
from .signup import availability_for_outing
from .timeutil import to_minutes

router = APIRouter()

DEFAULT_LENGTH = {"water": 90, "land": 60}  # minutes, when a session has no end time (as in the calendar feed)
ROWS = ("rower", "both")
COXES = ("cox", "both")


# ------------------------------------------------------------- helpers ----
def _interval(o: dict) -> Optional[tuple[int, int]]:
    s = to_minutes(o["time"]) if o["time"] else None
    if s is None:
        return None
    e = to_minutes(o["end_time"]) if o.get("end_time") else None
    if e is None or e <= s:
        e = s + DEFAULT_LENGTH.get(o["kind"], 60)
    return s, e


def _overlap(a: dict, b: dict) -> bool:
    if a["date"] != b["date"]:
        return False
    ia, ib = _interval(a), _interval(b)
    if ia is None or ib is None:
        return True  # a session without a time on the same day: assume they clash
    return ia[0] < ib[1] and ib[0] < ia[1]


def title_hints(title: str) -> tuple[Optional[str], Optional[str]]:
    """Squad ("open"/"women") and category ("Novice"/"Senior") suggested by a crew name
    such as "W1", "NM2", "Novice W" or "Senior men"."""
    squad = cat = None
    for w in re.findall(r"[a-z0-9']+", (title or "").lower()):
        w = w.replace("'", "")
        if w in ("women", "womens", "ladies") or re.fullmatch(r"n?w\d*", w):
            squad = "women"
        elif w in ("men", "mens", "open") or re.fullmatch(r"n?m\d*", w):
            squad = "open"
        if w in ("novice", "novices", "nov") or re.fullmatch(r"n[mw]\d*", w):
            cat = "Novice"
        elif w in ("senior", "seniors", "snr"):
            cat = "Senior"
    return squad, cat


def senior_quota(rowing_seats: int) -> tuple[int, int]:
    """(minimum, ideal) seniors in a novice boat: 2 and 3 in an eight, scaled for smaller boats."""
    if rowing_seats < 2:
        return 0, 0
    ideal = max(1, int(rowing_seats * 3 / 8 + 0.5))
    return max(1, rowing_seats * 2 // 8), ideal


def is_sweep(o: dict, boat: Optional[dict]) -> bool:
    """Same rule as the session editor: sculling boats (an "x" in the type) have no sides."""
    cap = o["capacity"]
    if o["kind"] != "water" or cap < 2:
        return False
    return "x" not in boat["boat_type"].lower() if boat else (cap == 8 or bool(o["coxed"]))


def side_of(seat: int, sweep: bool) -> str:
    return "" if seat == 0 or not sweep else ("S" if seat % 2 == 0 else "B")


# ------------------------------------------------------------- planner ----
class Planner:
    def __init__(self, conn, ws: date, include_published: bool = False):
        self.conn = conn
        self.rules = r = Rules(conn)
        self.ws = ws
        we = ws + timedelta(days=6)
        rng = random.Random(f"autofill-{ws.isoformat()}")
        self.boats = {b["id"]: dict(b) for b in conn.execute("SELECT * FROM boats")}
        week = [dict(o) for o in conn.execute(
            "SELECT * FROM outings WHERE date BETWEEN ? AND ? AND cancelled = 0 ORDER BY date, time, id",
            (ws.isoformat(), we.isoformat()))]
        self.outings = {o["id"]: o for o in week}
        self.crew: dict[int, dict[int, int]] = defaultdict(dict)  # outing -> seat -> member (saved)
        if week:
            qs = ",".join("?" * len(week))
            for a in conn.execute(f"SELECT * FROM assignments WHERE outing_id IN ({qs})", [o["id"] for o in week]):
                if a["member_id"] in r.members:
                    self.crew[a["outing_id"]][a["seat"]] = a["member_id"]
        self.new: dict[int, dict[int, int]] = defaultdict(dict)  # outing -> seat -> member (planned)
        self.new_coach: dict[int, str] = {}
        self.su = {s["member_id"]: dict(s) for s in conn.execute("SELECT * FROM signups WHERE week_start = ?", (ws.isoformat(),))
                   if s["member_id"] in r.members}
        self.tiebreak = {mid: rng.random() for mid in sorted(r.members)}

        # what everyone already has this week
        self.sessions: dict[int, list[tuple[dict, str]]] = defaultdict(list)  # member -> [(outing, "seat"|"br")]
        self.rows, self.coxes, self.land, self.br, self.duty = (defaultdict(int) for _ in range(5))
        for oid, seats in self.crew.items():
            o = self.outings[oid]
            for seat, mid in seats.items():
                self.sessions[mid].append((o, "seat"))
                if o["kind"] == "land":
                    self.land[mid] += 1
                elif seat == 0:
                    self.coxes[mid] += 1
                else:
                    self.rows[mid] += 1
            if o["kind"] == "water" and self._crew_category(oid) == "Novice":
                for seat, mid in seats.items():
                    if seat != 0 and r.members[mid]["category"] == "Senior":
                        self.duty[mid] += 1
        for o in week:  # bankriding / coaching, matched by name as in the calendar feed
            coach = o["coach"].lower()
            if not coach:
                continue
            for mid in self.su:
                if r.members[mid]["name"].lower() in coach and not any(x is o for x, _ in self.sessions[mid]):
                    self.br[mid] += 1
                    self.sessions[mid].append((o, "br"))
        self.before = {mid: (self.rows[mid], self.coxes[mid], self.br[mid]) for mid in self.su}
        self.planned_keys: dict[int, list] = defaultdict(list)

        # which outings to fill
        today = r.today.isoformat()
        self.targets, self.excluded_published = [], 0
        self.avail: dict[int, set] = {}
        self.has_slots: dict[int, bool] = {}
        for o in week:
            if o["kind"] != "water" or o["date"] < today:
                continue
            if o["published"] and not include_published:
                if self._empty_seats(o):
                    self.excluded_published += 1
                continue
            a = availability_for_outing(conn, "water", o["date"], o["time"])
            self.has_slots[o["id"]] = a["has_slots"]
            self.avail[o["id"]] = {mid for mid, x in a["members"].items() if x["available"] and mid in self.su}
            self.targets.append(o)
        self.open_targets = {o["id"] for o in self.targets}
        self.info: dict[int, dict] = {o["id"]: {"notes": [], "category": None, "squad": None} for o in self.targets}

    # ---- small queries ----------------------------------------------------
    def _seats(self, o: dict) -> list[int]:
        return seat_list(o["kind"], o["capacity"], bool(o["coxed"]) and o["kind"] == "water")

    def _taken(self, oid: int) -> dict[int, int]:
        return {**self.crew.get(oid, {}), **self.new.get(oid, {})}

    def _empty_seats(self, o: dict) -> list[int]:
        taken = self._taken(o["id"])
        return [s for s in self._seats(o) if s not in taken]

    def _crew_category(self, oid: int) -> Optional[str]:
        cats = [self.rules.members[m]["category"] for s, m in self._taken(oid).items() if s != 0]
        nov, sen = cats.count("Novice"), cats.count("Senior")
        if nov and nov >= sen:
            return "Novice"
        return "Senior" if sen else None

    def squad_of(self, mid: int) -> str:
        s = self.su.get(mid)
        return (s and s["squad"]) or self.rules.members[mid].get("squad") or ""

    def load(self, mid: int) -> int:
        return self.rows[mid] + self.coxes[mid] + self.land[mid] + self.br[mid]

    def has_room(self, mid: int, cox: bool) -> bool:
        """Below the most rowing (or coxing) outings they asked for this week."""
        s = self.su[mid]
        mx, given = (s["want_cox"], self.coxes[mid]) if cox else (s["want_row"], self.rows[mid])
        return (mx or 0) <= 0 or given < mx

    def busy(self, mid: int, o: dict, seat: bool = True) -> bool:
        for x, how in self.sessions[mid]:
            if x["id"] == o["id"] or _overlap(x, o):
                return True
            if seat and how == "seat" and x["kind"] == "water" and x["date"] == o["date"]:
                return True  # at most one water seat a day
        return False

    def eligible(self, mid: int, o: dict) -> bool:
        """Eligible for this outing, counting planned seats, without making a later outing ineligible."""
        r = self.rules
        key = (o["date"], o["time"], o["id"])
        keys = sorted(r.water_keys.get(mid, []) + self.planned_keys[mid])
        i = bisect.bisect_left(keys, key)
        base = r.members[mid]["past_water"]
        if not r.check(mid, "water", date.fromisoformat(o["date"]), key, before=base + i)["ok"]:
            return False
        for j, k in enumerate(keys[i:], start=i):
            d = date.fromisoformat(k[0])
            if (not r.check(mid, "water", d, k, before=base + j + 1)["ok"]
                    and r.check(mid, "water", d, k, before=base + j)["ok"]):
                return False
        return True

    def can_sit(self, mid: int, o: dict, cox: bool = False) -> bool:
        return self.has_room(mid, cox) and not self.busy(mid, o) and self.eligible(mid, o)

    def flex(self, mid: int) -> int:
        return sum(1 for t in self.open_targets if mid in self.avail.get(t, ()))

    # ---- one outing -------------------------------------------------------
    def classify(self, o: dict, pool: list[int]) -> tuple[Optional[str], Optional[str], str]:
        """(squad, category, how it was decided) for an outing's rowing seats."""
        r = self.rules
        seated = [m for s, m in self._taken(o["id"]).items() if s != 0]
        t_squad, t_cat = title_hints(o["title"])
        squads = [self.squad_of(m) for m in seated if self.squad_of(m)]
        if squads:
            squad, how_s = max(("open", "women"), key=squads.count), "crew"
        elif t_squad:
            squad, how_s = t_squad, "name"
        else:
            n_open = sum(1 for m in pool if self.squad_of(m) == "open")
            n_women = sum(1 for m in pool if self.squad_of(m) == "women")
            squad, how_s = (("open" if n_open >= n_women else "women"), "sign-ups") if (n_open or n_women) else (None, "")
        fits = [m for m in pool if not squad or self.squad_of(m) in (squad, "")]
        cats = [r.members[m]["category"] for m in seated]
        nov, sen = cats.count("Novice"), cats.count("Senior")
        _, ideal = senior_quota(len([s for s in self._seats(o) if s != 0]))
        if nov and nov >= sen:
            cat, how_c = "Novice", "crew"
        elif sen > max(ideal, nov):
            cat, how_c = "Senior", "crew"
        elif t_cat:
            cat, how_c = t_cat, "name"
        else:
            n_nov = sum(1 for m in fits if r.members[m]["category"] == "Novice")
            cat, how_c = ("Novice" if n_nov > len(fits) - n_nov else "Senior"), "sign-ups"
        return squad, cat, f"{how_s}/{how_c}"

    def trial(self, o: dict) -> dict:
        """Proposed seats for an outing's empty seats, given everything planned so far (no changes made)."""
        r, oid = self.rules, o["id"]
        empty = self._empty_seats(o)
        taken = set(self._taken(oid).values())
        avail = self.avail.get(oid, set())
        prop: dict[int, int] = {}
        out = {"seats": prop, "full": False, "notes": [], "squad": None, "category": None}
        if not empty:
            out["full"] = True
            return out

        # cox first: coxes are usually the scarcest
        if 0 in empty:
            no_coach = not o["coach"].strip()

            def cox_key(m):
                s = self.su[m]
                want, given = s["want_cox"] or 0, self.coxes[m]
                return (given >= want, given / max(want, 1), no_coach and r.members[m]["cox_status"] == "N",
                        s["role"] == "both", self.flex(m), self.tiebreak[m])
            cands = [m for m in avail if m not in taken and self.su[m]["role"] in COXES
                     and r.members[m]["cox_status"] and self.can_sit(m, o, cox=True)]
            if cands:
                prop[0] = min(cands, key=cox_key)
                taken.add(prop[0])
            else:
                out["notes"].append("No cox available")

        row_empty = [s for s in empty if s != 0]
        if row_empty:
            pool = [m for m in avail if m not in taken and self.su[m]["role"] in ROWS and self.can_sit(m, o)]
            squad, cat, _ = self.classify(o, pool)
            out["squad"], out["category"] = squad, cat
            fits = lambda m: not squad or self.squad_of(m) in (squad, "")
            seniors = [m for m in pool if r.members[m]["category"] == "Senior"]
            novices = [m for m in pool if r.members[m]["category"] != "Senior"]
            n_rowing = len([s for s in self._seats(o) if s != 0])
            if cat == "Novice":
                # squad hardly matters for novices: it's only a late tie-break (see _select)
                lo, ideal = senior_quota(n_rowing)
                have = sum(1 for s, m in self._taken(oid).items() if s != 0 and r.members[m]["category"] == "Senior")
                phases = [(seniors, max(0, ideal - have), True), (novices, None, False), (seniors, None, True)]
            else:
                # same squad first; the other squad only to fill seats (a full boat beats a split one)
                phases = [([m for m in seniors if fits(m)], None, False), ([m for m in novices if fits(m)], None, False),
                          ([m for m in seniors if not fits(m)], None, False), ([m for m in novices if not fits(m)], None, False)]
            picks = self._select(o, row_empty, phases, squad)
            prop.update(self._seat(o, row_empty, picks))
            other = sum(1 for m in picks if not fits(m))
            if cat != "Novice" and other and squad:
                theirs = "Women's" if squad == "open" else "Open"
                out["notes"].append(f"Mixed crew: {other} {theirs} rower{'' if other == 1 else 's'} added to fill the boat")
            if cat == "Novice" and n_rowing >= 2:
                lo, ideal = senior_quota(n_rowing)
                n_sen = sum(1 for s, m in {**self._taken(oid), **prop}.items() if s != 0 and r.members[m]["category"] == "Senior")
                if n_sen < lo:
                    out["notes"].append(f"Only {n_sen} senior{'' if n_sen == 1 else 's'} in this novice crew (aim for {lo}–{ideal})")
                elif n_sen > ideal:
                    out["notes"].append(f"{n_sen} seniors: not enough novices to fill the boat")
            short = len(row_empty) - len(picks)
            if short:
                out["notes"].append(f"{short} rowing seat{'' if short == 1 else 's'} still empty")
        out["full"] = len(prop) == len(empty)
        return out

    def _select(self, o: dict, row_empty: list[int], phases, squad: Optional[str] = None) -> list[int]:
        """Pick rowers phase by phase (pool, how many or None for as many as fit, rank by novice duty),
        keeping bow-only / stroke-only rowers within the free seats on their side. Within a phase,
        being in the boat's `squad` is a late tie-break."""
        sweep = is_sweep(o, self.boats.get(o["boat_id"]))
        n = len(row_empty)
        bow_free = sum(1 for s in row_empty if s % 2 == 1)
        stroke_free = n - bow_free
        picks: list[int] = []
        side = lambda m: (self.su[m]["side"] or "") if sweep else ""
        count = lambda pred: sum(1 for p in picks if pred(side(p)))

        def feasible(m):
            sd = side(m)
            if len(picks) >= n:
                return False
            if sd == "Bow side only":
                return count(lambda x: x == "Bow side only") < bow_free
            if sd == "Stroke side only":
                return count(lambda x: x == "Stroke side only") < stroke_free
            return True

        def side_pen(m):
            sd = side(m)
            if sd == "Bow side preferred":
                return int(count(lambda x: x.startswith("Bow")) >= bow_free)
            if sd == "Stroke side preferred":
                return int(count(lambda x: x.startswith("Stroke")) >= stroke_free)
            return 0

        def key(m, by_duty):
            s = self.su[m]
            want, given = s["want_row"] or 0, self.rows[m]
            ratio = given / max(want, 1)
            other_squad = bool(squad) and self.squad_of(m) not in (squad, "")
            return (given >= want, self.duty[m] if by_duty else 0, int(ratio * 3), side_pen(m), other_squad, ratio,
                    self.flex(m), self.tiebreak[m])

        for pool, limit, by_duty in phases:
            took = 0
            while limit is None or took < limit:
                cands = [m for m in pool if m not in picks and feasible(m)]
                if not cands:
                    break
                picks.append(min(cands, key=lambda m: key(m, by_duty)))
                took += 1
        return picks

    def _seat(self, o: dict, row_empty: list[int], picks: list[int]) -> dict[int, int]:
        """Put picked rowers in seats: side-only people on their side, then preferences, then balance."""
        sweep = is_sweep(o, self.boats.get(o["boat_id"]))
        free = sorted(row_empty, reverse=True)
        if not sweep:
            return dict(zip(free, picks))
        bow = [s for s in free if s % 2 == 1]
        stroke = [s for s in free if s % 2 == 0]
        out = {}
        sd = lambda m: self.su[m]["side"] or ""
        order = (["Bow side only", "Stroke side only", "Bow side preferred", "Stroke side preferred"])
        rest = [m for m in picks if sd(m) not in order]
        for pref in order:
            for m in [p for p in picks if sd(p) == pref]:
                first, second = (bow, stroke) if pref.startswith("Bow") else (stroke, bow)
                lst = first if first else second
                out[lst.pop(0)] = m
        for m in rest:
            lst = bow if len(bow) >= len(stroke) else stroke
            out[lst.pop(0)] = m
        return out

    def commit(self, o: dict, prop: dict, category: Optional[str]) -> None:
        r = self.rules
        key = (o["date"], o["time"], o["id"])
        for seat, mid in prop.items():
            self.new[o["id"]][seat] = mid
            self.sessions[mid].append((o, "seat"))
            self.planned_keys[mid].append(key)
            if seat == 0:
                self.coxes[mid] += 1
            else:
                self.rows[mid] += 1
                if category == "Novice" and r.members[mid]["category"] == "Senior":
                    self.duty[mid] += 1

    # ---- the whole week ---------------------------------------------------
    def run(self) -> dict:
        r = self.rules
        pending = []
        for o in self.targets:
            if not self.has_slots[o["id"]]:
                self.info[o["id"]]["notes"].append("No sign-up session matches this day and time, so nobody was placed")
                self.open_targets.discard(o["id"])
            elif self._empty_seats(o):
                pending.append(o)
            else:
                self.open_targets.discard(o["id"])

        def scarcity(o):
            empty = self._empty_seats(o)
            pool = sum(1 for m in self.avail[o["id"]] if self.can_sit(m, o) or self.can_sit(m, o, cox=True))
            return (pool / max(len(empty), 1), o["date"], o["time"], o["id"])

        # pass 1: outings that can be filled completely, hardest first
        deferred = []
        while pending:
            o = min(pending, key=scarcity)
            pending.remove(o)
            t = self.trial(o)
            if t["full"]:
                self.commit(o, t["seats"], t["category"])
                self.info[o["id"]].update(notes=self.info[o["id"]]["notes"] + t["notes"], squad=t["squad"], category=t["category"])
                self.open_targets.discard(o["id"])
            else:
                deferred.append(o)
        # pass 2: the rest get whoever is left
        for o in sorted(deferred, key=lambda x: (x["date"], x["time"], x["id"])):
            t = self.trial(o)
            self.commit(o, t["seats"], t["category"])
            self.info[o["id"]].update(notes=self.info[o["id"]]["notes"] + t["notes"], squad=t["squad"], category=t["category"])
            self.open_targets.discard(o["id"])

        # bankriders for outings with nobody in the coach / bankrider field
        def novice_cox(o):
            c = self._taken(o["id"]).get(0)
            return bool(c and r.members[c]["cox_status"] == "N")
        need = [o for o in self.targets if not o["coach"].strip() and self._taken(o["id"]) and self.has_slots[o["id"]]]
        for o in sorted(need, key=lambda x: (not novice_cox(x), x["date"], x["time"], x["id"])):
            inboat = set(self._taken(o["id"]).values())
            cands = [m for m in self.avail[o["id"]] if m not in inboat
                     and (self.su[m]["can_bankride"] or self.su[m]["role"] == "bankrider")
                     and not self.busy(m, o, seat=False)]
            if cands:
                m = min(cands, key=lambda m: (self.su[m]["role"] != "bankrider", self.br[m], self.load(m), self.tiebreak[m]))
                self.new_coach[o["id"]] = r.members[m]["name"]
                self.br[m] += 1
                self.sessions[m].append((o, "br"))
            elif novice_cox(o):
                self.info[o["id"]]["notes"].append("Novice cox: no bankrider available")
        return self.payload()

    def payload(self) -> dict:
        r = self.rules
        outs = []
        for o in self.targets:
            oid, sweep = o["id"], is_sweep(o, self.boats.get(o["boat_id"]))
            saved, new = self.crew.get(oid, {}), self.new.get(oid, {})
            cap = o["capacity"]
            seats = []
            for s in self._seats(o):
                mid = new.get(s, saved.get(s))
                m = r.members.get(mid) if mid else None
                seats.append({"seat": s, "label": seat_label(s, cap, "water"), "side": side_of(s, sweep),
                              "member": {"id": mid, "name": m["name"], "category": m["category"],
                                         "side": (self.su.get(mid) or {}).get("side", "")} if m else None,
                              "new": s in new})
            empty = sum(1 for x in seats if not x["member"])
            info = self.info[oid]
            status = ("skipped" if not self.has_slots[oid] else "unchanged" if not new and oid not in self.new_coach
                      else "full" if not empty else "partial")
            boat = self.boats.get(o["boat_id"])
            outs.append({
                "id": oid, "date": o["date"], "time": o["time"], "end_time": o["end_time"], "title": o["title"],
                "boat": boat["name"] if boat else "", "published": bool(o["published"]),
                "coach": o["coach"], "new_coach": self.new_coach.get(oid, ""),
                "squad": info["squad"], "category": info["category"],
                "seats": seats, "empty": empty, "added": len(new), "status": status, "notes": info["notes"],
            })
        people = []
        for mid, s in self.su.items():
            row0, cox0, br0 = self.before[mid]
            m = r.members[mid]
            people.append({
                "id": mid, "name": m["name"], "category": m["category"], "role": s["role"],
                "want_row": s["want_row"], "want_cox": s["want_cox"],
                "rows": self.rows[mid], "rows_before": row0, "coxes": self.coxes[mid], "coxes_before": cox0,
                "bankrides": self.br[mid], "bankrides_before": br0, "total": self.load(mid),
                "novice_outings": self.duty[mid] if m["category"] == "Senior" else 0,
            })
        people.sort(key=lambda p: r.members[p["id"]]["name"].lower())
        return {
            "start": self.ws.isoformat(), "signups": len(self.su), "outings": outs, "people": people,
            "added": sum(o["added"] for o in outs), "bankriders": len(self.new_coach),
            "full": sum(1 for o in outs if o["status"] == "full"),
            "partial": sum(1 for o in outs if o["status"] == "partial"),
            "excluded_published": self.excluded_published,
        }


# ------------------------------------------------------------ endpoints ----
def _monday(s: str) -> date:
    try:
        return monday_of(date.fromisoformat(s))
    except ValueError:
        raise HTTPException(400, "Bad date")


class AutofillIn(BaseModel):
    start: str
    include_published: bool = False


@router.post("/api/committee/week/autofill")
def autofill_preview(b: AutofillIn, _: str = Depends(require_committee)):
    """Proposed crews for the week's empty seats. Nothing is saved."""
    ws = _monday(b.start)
    with db.get_conn() as conn:
        return Planner(conn, ws, b.include_published).run()


class ApplyOuting(BaseModel):
    id: int
    seats: dict[str, int] = {}
    coach: str = Field("", max_length=120)


class ApplyIn(BaseModel):
    start: str
    outings: list[ApplyOuting] = Field([], max_length=100)


@router.post("/api/committee/week/autofill/apply")
def autofill_apply(b: ApplyIn, _: str = Depends(require_committee)):
    """Save the proposal the committee saw. Only seats that are still empty are filled, and only
    with people who aren't already in that outing; a bankrider is only set if the field is still empty."""
    ws = _monday(b.start)
    we = (ws + timedelta(days=6)).isoformat()
    added = coaches = skipped = 0
    with db.get_conn() as conn:
        before = push.snapshot(conn, ids=[x.id for x in b.outings])
        members = {r["id"] for r in conn.execute("SELECT id FROM members")}
        for x in b.outings:
            o = conn.execute("SELECT * FROM outings WHERE id = ?", (x.id,)).fetchone()
            if not o or o["kind"] != "water" or o["cancelled"] or not (ws.isoformat() <= o["date"] <= we):
                skipped += len(x.seats) + bool(x.coach)
                continue
            valid = set(seat_list("water", o["capacity"], bool(o["coxed"])))
            cur = {a["seat"]: a["member_id"] for a in conn.execute("SELECT seat, member_id FROM assignments WHERE outing_id = ?", (x.id,))}
            inboat = set(cur.values())
            for k, mid in x.seats.items():
                try:
                    s = int(k)
                except ValueError:
                    skipped += 1
                    continue
                if s not in valid or s in cur or mid not in members or mid in inboat:
                    skipped += 1
                    continue
                conn.execute("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?,?,?)", (x.id, s, mid))
                cur[s] = mid
                inboat.add(mid)
                added += 1
            if x.coach.strip():
                if o["coach"].strip():
                    skipped += 1
                else:
                    conn.execute("UPDATE outings SET coach = ? WHERE id = ?", (x.coach.strip(), x.id))
                    coaches += 1
        msgs = push.crew_changes(conn, before)
    push.dispatch(msgs)
    return {"added": added, "coaches": coaches, "skipped": skipped}
