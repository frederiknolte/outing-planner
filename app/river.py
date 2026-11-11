"""River rules for the Isis: the OURCs flag (fetched hourly) and the OURCs river restrictions.

Sources
  * Restrictions: https://ourcs.co.uk/information/river-restrictions/
  * Flag meanings: https://ourcs.co.uk/information/flags/isis/
  * Current flag (JSON): https://ourcs.co.uk/api/flags/status/isis/

The club boats from its own boathouse on the Isis, so only the Isis rules apply
(not Godstow or the St Edward's rafts). Reuben College is one of the clubs exempt
from the weekday 08:30-13:00 rule, so that rule isn't checked.

Every check gives warnings with a level, it never stops a session being saved:
  "stop": the session breaks a rule as things stand (e.g. Red flag, Sunday morning).
  "warn": something to check or arrange (e.g. Light Blue novice-cox conditions).
"""
from __future__ import annotations

import json
import math
import threading
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import timeutil
from .logic import to_date
from .timeutil import to_minutes

REACH = "isis"
FLAG_API = f"https://ourcs.co.uk/api/flags/status/{REACH}/"
FLAG_PAGE = f"https://ourcs.co.uk/information/flags/{REACH}/"
RULES_PAGE = "https://ourcs.co.uk/information/river-restrictions/"
LIGHT_BLUE_FORM = "https://forms.gle/4XxUp1GrdtZZhPMi8"
IFFLEY_LOCK = "01865 777 277"
OXFORD = (51.7520, -1.2577)  # lat, lon (east positive)
FETCH_EVERY_S = 3600
STALE_AFTER_S = 3 * 3600     # older than this: say the flag may be out of date

# Flag key -> display info. Keys are our own; the API's status_text is mapped onto them.
FLAGS = {
    "green": {"name": "Green", "colour": "#1e8e3e", "summary": "No restrictions on coxing status. Novice coxes must be accompanied by a bankrider."},
    "light_blue": {"name": "Light Blue", "colour": "#2aa7e0", "summary": "No unregistered coxes. No novice coxes, except those with at least one full term of coxing under strict conditions."},
    "dark_blue": {"name": "Dark Blue", "colour": "#1a3f8f", "summary": "No novice or unregistered coxes."},
    "amber": {"name": "Amber", "colour": "#f29900", "summary": "Only senior coxes with senior crews. Every crew needs a bankrider."},
    "red": {"name": "Red", "colour": "#d93025", "summary": "No crews allowed out."},
    "black": {"name": "Black", "colour": "#111111", "summary": "No crews allowed out. The bank may be flooded and the boathouse inaccessible."},
    "grey": {"name": "Grey", "colour": "#80868b", "summary": "Flag not being maintained (normally outside Full Term ± 1 week). The club must do its own risk assessment."},
}
_CODE = {"G": "green", "L": "light_blue", "A": "amber", "R": "red", "D": "black"}
NAV_LIMITS = ("No spinning at Longbridges except to land there. At the Haystacks, spin upstream of the "
              "red-and-white post and downstream of the early turning post near Donnington Bridge. "
              "Don't go above Folly Bridge or through Iffley Lock.")

# The full text, shown on the "River rules" page of the app.
RULES_TEXT = {
    "general": [
        "Nobody may row earlier than 1 hour before sunrise or later than 1 hour after sunset.",
        "Weekdays 08:30–13:00 in weeks 1–8: no rowing, except for some colleges (Reuben is one), single sculls, doubles and pairs, or with the Proctors' permission. Reuben is exempt, so this isn't checked.",
    ],
    "isis": [
        "Sundays: no crews on the water from 08:00 to 13:00 (all year).",
        "Wednesdays: no crews on the water after 19:00 (all year).",
    ],
    "peak": [
        "Peak term runs from the Thursday of 0th week to the last day of the term's major regatta (Tamesis in Michaelmas, Torpids in Hilary, Summer VIIIs in Trinity).",
        "Michaelmas & Hilary weekdays before 08:00: only one crew per club on the water at a time, unless the OURCs Secretary gives written permission or the club has an Extra Slot.",
        "Trinity weekdays before 08:00: no more than two 4s or 8s per club on the water at once, unless the OURCs Secretary gives written permission.",
        "Trinity weekdays 17:00–19:00: only crews in the Senior Eights divisions, the top crew of the division below, college 1st VIIIs, or single sculls.",
    ],
    "other": [
        "Regatta days have extra restrictions: check the OURCs notices.",
        "A flag doesn't mean it's safe to go out. Every crew must do its own risk assessment.",
    ],
    "senior_crew": "A senior crew has at least 4 rowers with three full terms of water rowing experience, and nobody with less than one term (not counting the cox).",
    "flags": {
        "green": ["No restrictions on coxing status.", "Novice coxes must be accompanied by a bankrider."],
        "light_blue": [
            "No unregistered coxes, and no novice coxes, except:",
            "A novice cox with at least one full term of coxing may go out only if ALL of these apply: between sunrise and sunset; "
            "the crew is senior; a bankrider has a throw line and a phone with the Iffley Lock-keeper's number (" + IFFLEY_LOCK + "); "
            "and the crew and bankrider's names are registered at least 2 hours ahead at " + LIGHT_BLUE_FORM + ".",
            NAV_LIMITS,
        ],
        "dark_blue": ["No novice or unregistered coxes.", NAV_LIMITS],
        "amber": [
            "Only senior coxes with senior crews.",
            "Every crew needs a bankrider with a throw line and a phone with the Iffley Lock-keeper's number (" + IFFLEY_LOCK + ").",
            NAV_LIMITS,
        ],
        "red": ["No crews allowed out."],
        "black": ["No crews allowed out. The bank may be flooded: take care on foot or by bike and avoid unnecessary trips. "
                  "Boathouses may be inaccessible: contact the boatman about equipment."],
        "grey": ["The flag isn't being maintained (normally outside Full Term ± 1 week). Clubs must assess conditions themselves."],
    },
    "stream": "The Isis flag follows the stream at Iffley: Green under 2 bucks open, Light Blue 2–3, Dark Blue 3–4, Amber 4–5, Red 5 or more.",
}


# ------------------------------------------------------------------ flag ----
def flag_key(status: str, status_text: str) -> str:
    t = (status_text or "").strip().lower()
    if "light" in t:
        return "light_blue"
    if "dark" in t or "navy" in t or t == "blue":
        return "dark_blue"
    for k in ("green", "amber", "red", "black", "grey", "gray"):
        if k in t:
            return "grey" if k == "gray" else k
    return _CODE.get((status or "").upper(), "unknown")


def fetch_flag(timeout: float = 15) -> dict:
    req = urllib.request.Request(FLAG_API, headers={"User-Agent": "OutingPlanner/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - fixed https URL
        data = json.loads(r.read(64 * 1024).decode("utf-8"))
    return {
        "key": flag_key(data.get("status", ""), data.get("status_text", "")),
        "status": str(data.get("status", ""))[:4],
        "status_text": str(data.get("status_text", ""))[:40],
        "notices": [str(n)[:300] for n in (data.get("notices") or [])][:10],
        "set_date": str(data.get("set_date", ""))[:40],
        "set_by": str(data.get("set_by", ""))[:80],
    }


def store_flag(conn, flag: dict | None, error: str = "") -> None:
    from .db import set_setting
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if flag is not None:
        set_setting(conn, "river_flag", json.dumps(flag))
        set_setting(conn, "river_flag_fetched_at", now)
    set_setting(conn, "river_flag_checked_at", now)
    set_setting(conn, "river_flag_error", error[:200])


def current_flag(settings: dict) -> dict:
    """The stored flag plus freshness info, for the API and the checks."""
    try:
        f = json.loads(settings.get("river_flag") or "null")
    except ValueError:
        f = None
    fetched = settings.get("river_flag_fetched_at") or ""
    stale = True
    if fetched:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(fetched)).total_seconds()
            stale = age > STALE_AFTER_S
        except ValueError:
            pass
    key = f["key"] if f else "unknown"
    info = FLAGS.get(key, {"name": "Unknown", "colour": "#80868b", "summary": "The current flag couldn't be fetched. Check the OURCs website."})
    return {
        "reach": "Isis", "key": key, "name": info["name"], "colour": info["colour"], "summary": info["summary"],
        "notices": (f or {}).get("notices", []), "set_date": (f or {}).get("set_date", ""), "set_by": (f or {}).get("set_by", ""),
        "fetched_at": fetched, "checked_at": settings.get("river_flag_checked_at") or "",
        "error": settings.get("river_flag_error") or "", "stale": stale, "page": FLAG_PAGE,
    }


def refresh_now(db_module) -> None:
    try:
        flag, err = fetch_flag(), ""
    except Exception as e:  # noqa: BLE001 - network problems just keep the last known flag
        flag, err = None, f"{type(e).__name__}: {e}"
    with db_module.get_conn() as conn:
        old = (db_module.get_settings(conn).get("river_flag") or "")
        store_flag(conn, flag, err)
    if flag is None:
        print(f"[river] flag fetch failed: {err}", flush=True)
    elif json.loads(old or "{}").get("key") != flag["key"]:
        print(f"[river] Isis flag is now {flag['status_text']}", flush=True)
    if flag is not None:
        try:
            from . import push
            push.check_flag()
        except Exception as e:  # noqa: BLE001 - a notification problem mustn't stop the flag job
            print(f"[river] flag alerts failed: {type(e).__name__}: {e}", flush=True)


def start_flag_thread(db_module, interval_s: int = FETCH_EVERY_S) -> None:
    """Fetch the Isis flag now and then every hour in the background."""
    def loop():
        while True:
            try:
                refresh_now(db_module)
            except Exception as e:  # noqa: BLE001 - never let the thread die
                print(f"[river] flag job failed: {e}", flush=True)
            time.sleep(interval_s)
    threading.Thread(target=loop, name="river-flag", daemon=True).start()


# ------------------------------------------------------------------- sun ----
def sun_times(d: date, tz: ZoneInfo, lat: float = OXFORD[0], lon: float = OXFORD[1]):
    """(sunrise, sunset) as local datetimes, from the standard sunrise equation (±1-2 min)."""
    n = d.toordinal() - date(2000, 1, 1).toordinal()
    j_star = n - lon / 360.0
    m = math.radians((357.5291 + 0.98560028 * j_star) % 360)
    c = 1.9148 * math.sin(m) + 0.02 * math.sin(2 * m) + 0.0003 * math.sin(3 * m)
    lam = math.radians((math.degrees(m) + c + 180 + 102.9372) % 360)
    j_transit = 2451545.0 + j_star + 0.0053 * math.sin(m) - 0.0069 * math.sin(2 * lam)
    decl = math.asin(math.sin(lam) * math.sin(math.radians(23.4397)))
    phi = math.radians(lat)
    cos_w = (math.sin(math.radians(-0.833)) - math.sin(phi) * math.sin(decl)) / (math.cos(phi) * math.cos(decl))
    w = math.degrees(math.acos(max(-1.0, min(1.0, cos_w))))

    def local(jd: float) -> datetime:
        return datetime.fromtimestamp((jd - 2440587.5) * 86400, tz=timezone.utc).astimezone(tz)
    return local(j_transit - w / 360), local(j_transit + w / 360)


def _mins(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def _hm(mins: int) -> str:
    mins = max(0, min(mins, 24 * 60 - 1))
    return f"{mins // 60:02d}:{mins % 60:02d}"


def day_info(d: date, tz: ZoneInfo) -> dict:
    rise, set_ = sun_times(d, tz)
    r, s = _mins(rise), _mins(set_)
    return {"sunrise": _hm(r), "sunset": _hm(s), "first": _hm(r - 60), "last": _hm(s + 60)}


# ----------------------------------------------------------------- terms ----
def term_info(settings: dict, d: date) -> dict:
    """Week of term and whether `d` is in peak term, from the settings."""
    out = {"week": None, "peak": False}
    start = to_date(settings.get("term_start"))
    if start is None:
        return out
    out["week"] = (d - start).days // 7 + 1  # weeks run Sunday-Saturday; 1st week starts on term_start
    # end of 8th week if the regatta date isn't set
    peak_end = to_date(settings.get("peak_end")) or start + timedelta(weeks=8, days=-1)
    out["peak"] = start - timedelta(days=3) <= d <= peak_end
    return out


# ---------------------------------------------------------------- checks ----
def interval(o: dict):
    return timeutil.interval(o.get("time"), o.get("end_time"), o.get("kind") or "water")


def _overlap(a, b) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def check_outing(o: dict, crew: dict, members: dict, boat: dict | None, settings: dict,
                 flag: dict, today: date, tz: ZoneInfo, others: list[dict]) -> list[dict]:
    """River-rule warnings for one water outing.

    o: outing row (date, time, end_time, coach, capacity, coxed)
    crew: {seat: member_id}; seat 0 is the cox
    others: other water outings on the same day (with "boat_type"/"capacity")
    """
    if o.get("kind") != "water":
        return []
    out: list[dict] = []
    add = lambda level, text: out.append({"level": level, "text": text})  # noqa: E731
    d = date.fromisoformat(o["date"])
    wd = d.weekday()
    iv = interval(o)
    sun = day_info(d, tz)
    rise, set_ = to_minutes(sun["sunrise"]), to_minutes(sun["sunset"])
    term = term_info(settings, d)
    t_name = settings.get("current_term", "")
    single = (boat and boat.get("boat_type") == "1x") or o.get("capacity") == 1

    # --- time of day -------------------------------------------------------
    if iv:
        if iv[0] < rise - 60:
            add("stop", f"Starts before {sun['first']}: no rowing earlier than 1 hour before sunrise ({sun['sunrise']}).")
        if iv[1] > set_ + 60:
            add("stop", f"{'Ends' if o.get('end_time') else 'Runs (90 min assumed)'} after {sun['last']}: no rowing later than 1 hour after sunset ({sun['sunset']}).")
        if wd == 6 and _overlap(iv, (8 * 60, 13 * 60)):
            add("stop", "Sunday 08:00–13:00: no crews on the Isis.")
        if wd == 2 and iv[1] > 19 * 60:
            add("stop", "Wednesday: no crews on the Isis after 19:00.")
        if term["peak"] and wd < 5:
            if iv[0] < 8 * 60:
                early = (iv[0], min(iv[1], 8 * 60))
                clash = [x for x in others if (xi := interval(x)) and xi[0] < 8 * 60 and _overlap(early, (xi[0], min(xi[1], 8 * 60)))]
                if t_name == "Trinity":
                    big = lambda x: (x.get("capacity") or 0) >= 4  # noqa: E731
                    if big(o) and sum(1 for x in clash if big(x)) >= 2:
                        add("stop", "Peak term (Trinity): no more than two 4s or 8s per club on the water before 08:00, unless the OURCs Secretary agrees in writing.")
                else:
                    try:
                        allowed = max(1, int(settings.get("peak_crews_before_8") or 1))
                    except ValueError:
                        allowed = 1
                    if len(clash) + 1 > allowed:
                        add("stop", f"Peak term: only {allowed} crew{'s' if allowed > 1 else ''} per club on the water at a time before 08:00 "
                                    f"({len(clash) + 1} planned). Needs an Extra Slot or the OURCs Secretary's written permission.")
            if t_name == "Trinity" and not single and _overlap(iv, (17 * 60, 19 * 60)):
                add("warn", "Peak term (Trinity) 17:00–19:00: only Senior Eights division crews, the top crew of the division below, college 1st VIIIs or single sculls.")
    else:
        add("warn", "No start time, so the river time rules can't be checked.")

    # --- flag --------------------------------------------------------------
    if d < today:
        return out
    key, fname = flag["key"], flag["name"]
    cox = members.get(crew.get(0)) if o.get("coxed") else None
    cox_status = (cox or {}).get("cox_status", "")
    rowers = [members[m] for s, m in crew.items() if s != 0 and m in members]
    seniors = sum(1 for m in rowers if m.get("category") == "Senior")
    novices = [m["name"] for m in rowers if m.get("category") not in ("Senior", "Coach")]
    need = min(4, o.get("capacity") or 4)
    senior_crew = seniors >= need and not novices
    bankrider = bool((o.get("coach") or "").strip())
    pre = f"{fname} flag"

    def crew_problem() -> str:
        if novices:
            return f"{', '.join(novices[:3])}{'…' if len(novices) > 3 else ''} {'is a novice' if len(novices) == 1 else 'are novices'} — nobody may have less than one term's experience"
        return f"only {seniors} senior rower{'s' if seniors != 1 else ''} (needs {need} with three terms' experience)"

    if key in ("red", "black"):
        add("stop", f"{pre}: no crews allowed out.")
    elif key == "amber":
        if cox and cox_status != "S":
            add("stop", f"{pre}: only senior coxes ({cox['name']} isn't marked Senior).")
        if crew and not senior_crew:
            add("stop", f"{pre}: senior crews only — {crew_problem()}.")
        if not bankrider:
            add("stop", f"{pre}: every crew needs a bankrider with a throw line and phone (Iffley Lock {IFFLEY_LOCK}).")
    elif key == "dark_blue":
        if cox and cox_status not in ("X", "S"):
            add("stop", f"{pre}: no novice or unregistered coxes ({cox['name']} is {'a novice cox' if cox_status == 'N' else 'not registered as a cox'}).")
    elif key == "light_blue":
        if cox and cox_status not in ("N", "X", "S"):
            add("stop", f"{pre}: no unregistered coxes ({cox['name']} has no cox status).")
        elif cox and cox_status == "N":
            probs = []
            if iv and (iv[0] < rise or iv[1] > set_):
                probs.append(f"must be between sunrise and sunset ({sun['sunrise']}–{sun['sunset']})")
            if not senior_crew:
                probs.append(f"crew must be senior ({crew_problem()})")
            if not bankrider:
                probs.append("needs a bankrider with throw line and phone")
            if probs:
                add("stop", f"{pre}: novice cox {cox['name']} — " + "; ".join(probs) + ".")
            add("warn", f"{pre}: novice cox needs at least one full term of coxing, and the crew and bankrider must be registered 2 hours ahead at {LIGHT_BLUE_FORM}.")
    elif key == "grey":
        add("warn", f"{pre}: OURCs isn't monitoring the stream. Do your own risk assessment.")
    elif key == "unknown":
        add("warn", "Current flag unknown — check the OURCs website before going out.")
    if key != "unknown" and flag.get("stale"):
        add("warn", "The flag couldn't be updated recently, so it may be out of date.")
    return out
