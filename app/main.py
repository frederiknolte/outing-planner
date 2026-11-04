"""Boat club outing planner — FastAPI app."""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import os
import secrets
import time
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from . import db
from .auth import require_committee, require_member, role_of
from . import privacy
from . import river
from .timeutil import normalize as norm_time, to_minutes
from .calendar import router as calendar_router
from .signup import availability_for_outing, week_counts, router as signup_router
from .stats import router as stats_router
from .races import router as races_router
from . import issues
from .committee_roster import router as roster_router
from .tasks import router as tasks_router
from .autofill import router as autofill_router
from .usage import router as usage_router
from .logic import (BOAT_TYPES, CANCEL_REASONS, SUBS_PLANS, TERMS, TZ, Rules, monday_of, outing_payload,
                    seat_label, seat_list)

STATIC = os.path.join(os.path.dirname(__file__), "static")

COMMITTEE_PASSWORD = os.environ.get("COMMITTEE_PASSWORD", "")
MEMBER_PASSWORD = os.environ.get("MEMBER_PASSWORD", "")
if not COMMITTEE_PASSWORD or not MEMBER_PASSWORD:
    raise SystemExit("COMMITTEE_PASSWORD and MEMBER_PASSWORD environment variables must both be set.")
if COMMITTEE_PASSWORD == MEMBER_PASSWORD:
    raise SystemExit("COMMITTEE_PASSWORD and MEMBER_PASSWORD must be different.")

db.init_db()
if _n := issues.sweep_orphans():
    print(f"[issues] removed {_n} photo file(s) with no matching issue", flush=True)
with db.get_conn() as _c:
    _r = privacy.migrate(_c)
    if _r["encrypted"]:
        print(f"[privacy] encrypted {_r['encrypted']} stored phone number(s)", flush=True)
if _r["encrypted"]:
    # Rewrite the database file so no unencrypted copies remain in free space or the WAL.
    _v = db.connect()
    try:
        _v.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        _v.execute("VACUUM")
        _v.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        _v.close()
    if _r["plaintext_left"]:
        print(f"[privacy] WARNING: {_r['plaintext_left']} phone number(s) stored unencrypted; set PHONE_KEY to encrypt them", flush=True)
privacy.start_retention_thread(db)
if os.environ.get("RIVER_FLAG_FETCH", "on").lower() not in ("off", "0", "false"):
    river.start_flag_thread(db)


def _secret_key() -> str:
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    path = os.path.join(db.DATA_DIR, ".secret_key")
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    key = secrets.token_urlsafe(48)
    with open(path, "w") as f:
        f.write(key)
    os.chmod(path, 0o600)
    return key


app = FastAPI(title="Reuben Boat Club Outing Planner", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    SessionMiddleware,
    secret_key=_secret_key(),
    session_cookie="op_session",
    max_age=60 * 60 * 24 * 30,
    same_site="lax",
    https_only=os.environ.get("COOKIE_SECURE", "0") == "1",
)


# ---------------------------------------------------------------- auth ----
def _hash_pw(pw: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return salt.hex() + "$" + h.hex()


def _check_hash(pw: str, stored: str) -> bool:
    try:
        salt_hex, h_hex = stored.split("$")
        return hmac.compare_digest(_hash_pw(pw, bytes.fromhex(salt_hex)).split("$")[1], h_hex)
    except ValueError:
        return False


_attempts: dict[str, list[float]] = defaultdict(list)


def _rate_limited(ip: str) -> bool:
    now = time.time()
    _attempts[ip] = [t for t in _attempts[ip] if now - t < 300]
    return len(_attempts[ip]) >= 10


class LoginIn(BaseModel):
    password: str


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    ip = request.client.host if request.client else "?"
    if _rate_limited(ip):
        raise HTTPException(429, "Too many attempts — try again in a few minutes")
    pw = body.password
    role = None
    if hmac.compare_digest(pw.encode(), COMMITTEE_PASSWORD.encode()):
        role = "committee"
    else:
        with db.get_conn() as conn:
            stored = db.get_settings(conn).get("member_password_hash")
        if stored:
            ok = _check_hash(pw, stored)
        else:
            ok = hmac.compare_digest(pw.encode(), MEMBER_PASSWORD.encode())
        if ok:
            role = "member"
    if not role:
        _attempts[ip].append(time.time())
        raise HTTPException(401, "Wrong password")
    request.session.clear()
    request.session["role"] = role
    return {"role": role}


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    return {"role": role_of(request)}


# ------------------------------------------------------------- helpers ----
def _week_start(start: Optional[str], rules: Rules) -> date:
    if start:
        try:
            return monday_of(date.fromisoformat(start))
        except ValueError:
            raise HTTPException(400, "Bad date")
    return monday_of(rules.today)


def _boats(conn) -> dict:
    return {r["id"]: dict(r) for r in conn.execute("SELECT * FROM boats")}


def _outings_payload(conn, rules: Rules, where: str, params: tuple, committee: bool) -> list[dict]:
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
    boats = _boats(conn)
    flag = river.current_flag(rules.settings)
    day_water = defaultdict(list)  # date -> water outings that day (for the before-8am crew limits)
    for r in conn.execute(f"SELECT id, kind, date, time, end_time, capacity FROM outings WHERE kind='water' AND cancelled = 0 AND date IN ({dq})", dates):
        day_water[r["date"]].append(dict(r))
    boat_slot = defaultdict(list)
    for o in conn.execute(f"SELECT id, date, time, boat_id FROM outings WHERE date IN ({dq}) AND boat_id IS NOT NULL AND cancelled = 0", dates):
        boat_slot[(o["date"], o["time"], o["boat_id"])].append(o["id"])
    out = []
    for o in outings:
        p = outing_payload(rules, o, assigns[o["id"]], subs[o["id"]], boats,
                           slot.get((o["date"], o["time"]), {}) if o["time"] else {}, committee)
        crew = {a["seat"]: a["member_id"] for a in assigns[o["id"]]}
        p["river"] = [] if o["cancelled"] else river.check_outing(o, crew, rules.members, boats.get(o["boat_id"]), rules.settings, flag,
                                        rules.today, TZ, [x for x in day_water[o["date"]] if x["id"] != o["id"]])
        if committee and o["boat_id"] and o["time"] and len(boat_slot[(o["date"], o["time"], o["boat_id"])]) > 1:
            p["warnings"].append(f"{boats[o['boat_id']]['name']} is booked twice at this time")
        out.append(p)
    return out


# ------------------------------------------------------------ bootstrap ----
@app.get("/api/bootstrap")
def bootstrap(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        s = rules.settings
        members = [
            {"id": m["id"], "name": m["name"], "category": m["category"], "cox_status": m["cox_status"]}
            for m in sorted(rules.members.values(), key=lambda m: m["name"].lower()) if m["active"]
        ]
        return {
            "role": role,
            "club_name": s.get("club_name"),
            "today": rules.today.isoformat(),
            "this_week": monday_of(rules.today).isoformat(),
            "members": members,
            "settings": {
                "academic_year": s.get("academic_year"), "current_term": s.get("current_term"),
                "novice_free_outings": rules.free_n,
            },
        }


# ---------------------------------------------------------------- week ----
@app.get("/api/week")
def week(start: Optional[str] = None, role: str = Depends(require_member)):
    committee = role == "committee"
    with db.get_conn() as conn:
        rules = Rules(conn)
        ws = _week_start(start, rules)
        we = ws + timedelta(days=6)
        where = "date BETWEEN ? AND ?" + ("" if committee else " AND published = 1")
        outings = _outings_payload(conn, rules, where, (ws.isoformat(), we.isoformat()), committee)
        counts = conn.execute(
            "SELECT COUNT(*) AS n, SUM(published) AS p FROM outings WHERE date BETWEEN ? AND ?",
            (ws.isoformat(), we.isoformat())).fetchone()
        return {
            "start": ws.isoformat(),
            "days": [(ws + timedelta(days=i)).isoformat() for i in range(7)],
            "outings": outings,
            "total": counts["n"] or 0,
            "published": counts["p"] or 0,
            "today": rules.today.isoformat(),
            "river": {"flag": river.current_flag(rules.settings),
                      "days": {(ws + timedelta(days=i)).isoformat(): river.day_info(ws + timedelta(days=i), TZ) for i in range(7)}},
        }


# ------------------------------------------------------------- members ----
@app.get("/api/members/{member_id}/summary")
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
            upcoming = _outings_payload(conn, rules, f"id IN ({qs})", tuple(ids), role == "committee")
        status = rules.status_now(member_id)
        return {
            "member": {"id": m["id"], "name": m["name"], "category": m["category"], "cox_status": m["cox_status"]},
            "totals": rules.totals(member_id),
            "status": {"water_ok": status["water"]["ok"], "land_ok": status["land"]["ok"],
                       "water_reasons": status["water"]["reasons"], "land_reasons": status["land"]["reasons"],
                       "subs_valid": status["subs_valid"], "swim_test": bool(m["swim_test"])},
            "upcoming": upcoming,
        }


@app.get("/api/rowers")
def rowers(role: str = Depends(require_member)):
    """Outing counts for everyone (visible to all signed-in users)."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        out = []
        for m in rules.members.values():
            if not m["active"]:
                continue
            out.append({"id": m["id"], "name": m["name"], "category": m["category"],
                        "cox_status": m["cox_status"], **rules.totals(m["id"])})
        out.sort(key=lambda r: r["name"].lower())
        return out


class RowerIn(BaseModel):
    """What any rower may set when adding someone. Subs, swim test, cox status, category
    and notes stay committee-only; the new entry is flagged for committee review."""
    name: str = Field(..., min_length=1, max_length=100)
    college: str = Field("", max_length=80)
    side: str = Field("", max_length=40)


@app.post("/api/rowers")
def rower_create(b: RowerIn, role: str = Depends(require_member)):
    name = " ".join(b.name.split())
    if len(name) < 3 or " " not in name:
        raise HTTPException(400, "Please enter a full name (first and last)")
    from .signup import SIDES
    if b.side and b.side not in SIDES:
        raise HTTPException(400, "Bad side preference")
    with db.get_conn() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO members(name, category, cox_status, needs_review, notes, college, side)
                   VALUES (?, 'Novice', '', 1, 'Added from the rower list', ?, ?)""",
                (name, b.college.strip(), b.side))
        except db.sqlite3.IntegrityError:
            raise HTTPException(400, "Someone with that name is already on the list")
        return {"id": cur.lastrowid}


# ---------------------------------------------------------------- subs ----
class SubRequestIn(BaseModel):
    outing_id: int
    member_id: int
    reason: str = Field("", max_length=300)
    # Set when the rower already found a sub themselves (e.g. offline): the seat is handed
    # straight to them instead of being posted to the sub board.
    sub_id: Optional[int] = None


class SubFillIn(BaseModel):
    member_id: int


class SubCancelIn(BaseModel):
    member_id: Optional[int] = None


def _sub_rows(conn, rules: Rules, where: str, params: tuple, committee: bool) -> list[dict]:
    rows = [dict(r) for r in conn.execute(
        f"""SELECT s.*, o.kind, o.date, o.time, o.end_time, o.title, o.location, o.capacity, o.coxed, o.boat_id
            FROM sub_requests s JOIN outings o ON o.id = s.outing_id WHERE {where}
            ORDER BY o.date, o.time, s.id""", params)]
    boats = _boats(conn)
    out = []
    for r in rows:
        req = rules.members.get(r["requester_id"], {})
        sub = rules.members.get(r["sub_id"], {}) if r["sub_id"] else {}
        boat = boats.get(r["boat_id"])
        out.append({
            "id": r["id"], "status": r["status"], "reason": r["reason"], "created_at": r["created_at"],
            "resolved_at": r["resolved_at"], "seat": r["seat"],
            "seat_label": seat_label(r["seat"], r["capacity"], r["kind"]),
            "requester": {"id": r["requester_id"], "name": req.get("name")},
            "sub": {"id": r["sub_id"], "name": sub.get("name")} if r["sub_id"] else None,
            "outing": {"id": r["outing_id"], "kind": r["kind"], "date": r["date"], "time": r["time"], "end_time": r["end_time"],
                       "title": r["title"], "location": r["location"],
                       "boat": boat["name"] if boat else None},
        })
    return out


@app.get("/api/subs")
def list_subs(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        today = rules.today.isoformat()
        open_ = _sub_rows(conn, rules, "s.status = 'open' AND o.date >= ? AND o.published = 1", (today,), role == "committee")
        recent = _sub_rows(conn, rules, "s.status = 'filled' AND o.date >= ?",
                           ((rules.today - timedelta(days=7)).isoformat(),), role == "committee")
        return {"open": open_, "recent": recent[-30:]}


@app.get("/api/subs/{sub_id}/candidates")
def sub_candidates(sub_id: int, role: str = Depends(require_member)):
    """Who could take this seat, with eligibility — used to pre-warn people volunteering."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        r = conn.execute("SELECT s.*, o.kind, o.date, o.time FROM sub_requests s JOIN outings o ON o.id=s.outing_id WHERE s.id=?", (sub_id,)).fetchone()
        if not r:
            raise HTTPException(404, "Not found")
        return {str(mid): _candidate_status(conn, rules, mid, r["outing_id"], r["seat"]) for mid in rules.members}


@app.get("/api/outings/{oid}/sub-candidates")
def seat_sub_candidates(oid: int, member_id: int, role: str = Depends(require_member)):
    """Who could take this member's seat — used when a rower picks their own sub."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        o = conn.execute("SELECT * FROM outings WHERE id = ?", (oid,)).fetchone()
        if not o or (not o["published"] and role != "committee"):
            raise HTTPException(404, "Outing not found")
        a = conn.execute("SELECT seat FROM assignments WHERE outing_id=? AND member_id=?", (oid, member_id)).fetchone()
        if not a:
            raise HTTPException(400, "That person isn't in this outing")
        return {str(mid): _candidate_status(conn, rules, mid, oid, a["seat"]) for mid in rules.members}


def _candidate_status(conn, rules: Rules, member_id: int, outing_id: int, seat: int) -> dict:
    o = conn.execute("SELECT * FROM outings WHERE id = ?", (outing_id,)).fetchone()
    m = rules.members[member_id]
    elig = rules.check(member_id, o["kind"], date.fromisoformat(o["date"]), (o["date"], o["time"], o["id"]))
    problems = list(elig["reasons"])
    if conn.execute("SELECT 1 FROM assignments WHERE outing_id=? AND member_id=?", (outing_id, member_id)).fetchone():
        problems.append("Already in this outing")
    elif o["time"] and conn.execute(
            """SELECT 1 FROM assignments a JOIN outings x ON x.id=a.outing_id
               WHERE a.member_id=? AND x.date=? AND x.time=? AND x.id != ? AND x.cancelled = 0""",
            (member_id, o["date"], o["time"], outing_id)).fetchone():
        problems.append("Booked in another outing at this time")
    if o["kind"] == "water" and seat == 0 and not m["cox_status"]:
        problems.append("Not a cox")
    return {"ok": not problems, "problems": problems, "note": elig["note"]}


@app.post("/api/subs")
def request_sub(body: SubRequestIn, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        o = conn.execute("SELECT * FROM outings WHERE id = ?", (body.outing_id,)).fetchone()
        if not o or (not o["published"] and role != "committee"):
            raise HTTPException(404, "Outing not found")
        if o["date"] < rules.today.isoformat():
            raise HTTPException(400, "This outing is in the past")
        if o["cancelled"]:
            raise HTTPException(400, "This outing has been cancelled")
        a = conn.execute("SELECT * FROM assignments WHERE outing_id=? AND member_id=?",
                         (body.outing_id, body.member_id)).fetchone()
        if not a:
            raise HTTPException(400, "That person isn't in this outing")
        if conn.execute("SELECT 1 FROM sub_requests WHERE outing_id=? AND seat=? AND status='open'",
                        (body.outing_id, a["seat"])).fetchone():
            raise HTTPException(400, "A sub has already been requested for this seat")
        if body.sub_id is not None:
            if body.sub_id not in rules.members:
                raise HTTPException(400, "Unknown member")
            if body.sub_id == body.member_id:
                raise HTTPException(400, "You can't sub for yourself")
            st = _candidate_status(conn, rules, body.sub_id, body.outing_id, a["seat"])
            if not st["ok"]:
                raise HTTPException(400, "Can't sub: " + "; ".join(st["problems"]))
            conn.execute("UPDATE assignments SET member_id=? WHERE outing_id=? AND seat=? AND member_id=?",
                         (body.sub_id, body.outing_id, a["seat"], body.member_id))
            conn.execute("""INSERT INTO sub_requests(outing_id, seat, requester_id, reason, status, sub_id, resolved_at)
                            VALUES (?, ?, ?, ?, 'filled', ?, datetime('now'))""",
                         (body.outing_id, a["seat"], body.member_id, body.reason.strip(), body.sub_id))
            return {"ok": True}
        conn.execute("INSERT INTO sub_requests(outing_id, seat, requester_id, reason) VALUES (?, ?, ?, ?)",
                     (body.outing_id, a["seat"], body.member_id, body.reason.strip()))
        return {"ok": True}


@app.post("/api/subs/{sub_id}/fill")
def fill_sub(sub_id: int, body: SubFillIn, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        s = conn.execute("SELECT * FROM sub_requests WHERE id = ?", (sub_id,)).fetchone()
        if not s or s["status"] != "open":
            raise HTTPException(400, "This sub request is no longer open")
        if body.member_id not in rules.members:
            raise HTTPException(400, "Unknown member")
        if body.member_id == s["requester_id"]:
            raise HTTPException(400, "You can't sub for yourself — cancel the request instead")
        if conn.execute("SELECT cancelled FROM outings WHERE id = ?", (s["outing_id"],)).fetchone()["cancelled"]:
            raise HTTPException(400, "This outing has been cancelled")
        st = _candidate_status(conn, rules, body.member_id, s["outing_id"], s["seat"])
        if not st["ok"]:
            raise HTTPException(400, "Can't sub: " + "; ".join(st["problems"]))
        cur = conn.execute("UPDATE assignments SET member_id=? WHERE outing_id=? AND seat=? AND member_id=?",
                           (body.member_id, s["outing_id"], s["seat"], s["requester_id"]))
        if cur.rowcount != 1:
            raise HTTPException(409, "The seat has changed — refresh and try again")
        conn.execute("UPDATE sub_requests SET status='filled', sub_id=?, resolved_at=datetime('now') WHERE id=?",
                     (body.member_id, sub_id))
        return {"ok": True}


@app.post("/api/subs/{sub_id}/cancel")
def cancel_sub(sub_id: int, body: SubCancelIn, role: str = Depends(require_member)):
    with db.get_conn() as conn:
        s = conn.execute("SELECT * FROM sub_requests WHERE id = ?", (sub_id,)).fetchone()
        if not s or s["status"] != "open":
            raise HTTPException(400, "This sub request is no longer open")
        if role != "committee" and body.member_id != s["requester_id"]:
            raise HTTPException(403, "Only the person who asked (or an committee) can cancel this")
        conn.execute("UPDATE sub_requests SET status='cancelled', resolved_at=datetime('now') WHERE id=?", (sub_id,))
        return {"ok": True}


# ------------------------------------------------- open land sessions ----
class JoinIn(BaseModel):
    member_id: int


def _land_outing(conn, rules: Rules, oid: int, role: str):
    o = conn.execute("SELECT * FROM outings WHERE id = ?", (oid,)).fetchone()
    if not o or (not o["published"] and role != "committee"):
        raise HTTPException(404, "Session not found")
    if o["kind"] != "land":
        raise HTTPException(400, "Only land sessions are open to join. Water crews are picked by the coaches")
    if o["date"] < rules.today.isoformat():
        raise HTTPException(400, "This session is in the past")
    if o["cancelled"]:
        raise HTTPException(400, "This session has been cancelled")
    return o


@app.post("/api/outings/{oid}/join")
def outing_join(oid: int, b: JoinIn, role: str = Depends(require_member)):
    """A rower takes a free spot in a land session."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        o = _land_outing(conn, rules, oid, role)
        if b.member_id not in rules.members:
            raise HTTPException(400, "Unknown member")
        st = _candidate_status(conn, rules, b.member_id, oid, 1)
        if not st["ok"]:
            raise HTTPException(400, "Can't join: " + "; ".join(st["problems"]))
        taken = {r["seat"] for r in conn.execute("SELECT seat FROM assignments WHERE outing_id = ?", (oid,))}
        free = [s for s in range(1, o["capacity"] + 1) if s not in taken]
        if not free:
            raise HTTPException(400, "Sorry, this session is full")
        try:
            conn.execute("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?, ?, ?)", (oid, free[0], b.member_id))
        except db.sqlite3.IntegrityError:
            raise HTTPException(409, "Someone just took that spot. Please try again")
        return {"ok": True}


@app.post("/api/outings/{oid}/leave")
def outing_leave(oid: int, b: JoinIn, role: str = Depends(require_member)):
    """A rower gives up their spot in a land session (no sub needed; the spot just reopens)."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        _land_outing(conn, rules, oid, role)
        a = conn.execute("SELECT seat FROM assignments WHERE outing_id = ? AND member_id = ?", (oid, b.member_id)).fetchone()
        if not a:
            raise HTTPException(400, "You're not in this session")
        conn.execute("DELETE FROM assignments WHERE outing_id = ? AND member_id = ?", (oid, b.member_id))
        conn.execute("""UPDATE sub_requests SET status = 'cancelled', resolved_at = datetime('now')
                        WHERE outing_id = ? AND seat = ? AND status = 'open'""", (oid, a["seat"]))
        return {"ok": True}


# ========================================================== COMMITTEE =====
# ---------------------------------------------------------------- boats ----
class BoatIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    boat_type: str = "8+"
    seats: int = Field(8, ge=1, le=8)
    coxed: bool = True
    status: str = "available"
    rigging: str = Field("", max_length=120)
    notes: str = Field("", max_length=500)


@app.get("/api/committee/boats")
def boats_list(role: str = Depends(require_member)):
    # readable by everyone signed in (boat park view); edits are committee only
    with db.get_conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM boats ORDER BY status != 'available', seats DESC, name")]
        today = Rules(conn).today.isoformat()
        usage = {r["boat_id"]: r["n"] for r in conn.execute(
            "SELECT boat_id, COUNT(*) n FROM outings WHERE boat_id IS NOT NULL AND cancelled = 0 GROUP BY boat_id")}
        nxt = {r["boat_id"]: r["d"] for r in conn.execute(
            "SELECT boat_id, MIN(date) d FROM outings WHERE boat_id IS NOT NULL AND cancelled = 0 AND date >= ? GROUP BY boat_id", (today,))}
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


def _boat_validate(b: BoatIn):
    if b.status not in ("available", "repair", "retired"):
        raise HTTPException(400, "Bad status")
    if b.boat_type not in BOAT_TYPES:
        raise HTTPException(400, "Bad boat type")


@app.post("/api/committee/boats")
def boat_create(b: BoatIn, _: str = Depends(require_committee)):
    _boat_validate(b)
    with db.get_conn() as conn:
        try:
            cur = conn.execute("INSERT INTO boats(name, boat_type, seats, coxed, status, rigging, notes) VALUES (?,?,?,?,?,?,?)",
                               (b.name.strip(), b.boat_type, b.seats, int(b.coxed), b.status, b.rigging, b.notes))
        except db.sqlite3.IntegrityError:
            raise HTTPException(400, "A boat with that name already exists")
        return {"id": cur.lastrowid}


@app.put("/api/committee/boats/{boat_id}")
def boat_update(boat_id: int, b: BoatIn, _: str = Depends(require_committee)):
    _boat_validate(b)
    with db.get_conn() as conn:
        try:
            conn.execute("UPDATE boats SET name=?, boat_type=?, seats=?, coxed=?, status=?, rigging=?, notes=? WHERE id=?",
                         (b.name.strip(), b.boat_type, b.seats, int(b.coxed), b.status, b.rigging, b.notes, boat_id))
        except db.sqlite3.IntegrityError:
            raise HTTPException(400, "A boat with that name already exists")
        return {"ok": True}


@app.delete("/api/committee/boats/{boat_id}")
def boat_delete(boat_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        issues.delete_boat_photos(conn, boat_id)
        conn.execute("DELETE FROM boats WHERE id=?", (boat_id,))
        return {"ok": True}


# -------------------------------------------------------------- members ----
class MemberIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    category: str = "Novice"
    swim_test: bool = False
    subs_plan: str = "Unpaid"
    subs_term: str = ""
    subs_year: str = ""
    cox_status: str = ""
    past_water: int = Field(0, ge=0)
    past_land: int = Field(0, ge=0)
    active: bool = True
    notes: str = Field("", max_length=500)
    phone: Optional[str] = Field(None, max_length=40)   # None = keep the stored number, "" = delete it
    college: str = Field("", max_length=80)
    side: str = Field("", max_length=40)
    squad: str = ""                                      # '' | open | women (race eligibility)


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


def _member_validate(m: MemberIn):
    if m.category not in ("Novice", "Senior"):
        raise HTTPException(400, "Category must be Novice or Senior")
    if m.subs_plan not in SUBS_PLANS:
        raise HTTPException(400, "Bad subs plan")
    if m.cox_status not in ("", "N", "X", "S"):
        raise HTTPException(400, "Bad cox status")
    if m.squad not in ("", "open", "women"):
        raise HTTPException(400, "Bad squad")


@app.get("/api/committee/members")
def members_list(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        out = []
        for m in sorted(rules.members.values(), key=lambda m: m["name"].lower()):
            st = rules.status_now(m["id"])
            safe = {k: v for k, v in m.items() if k not in ("phone", "cal_token")}
            out.append({**safe, "has_phone": bool(m["phone"]), "phone_masked": privacy.mask(m["phone"]),
                        "swim_test": bool(m["swim_test"]), "active": bool(m["active"]),
                        "totals": rules.totals(m["id"]), "subs_valid": st["subs_valid"],
                        "water_ok": st["water"]["ok"], "land_ok": st["land"]["ok"],
                        "water_reasons": st["water"]["reasons"], "land_reasons": st["land"]["reasons"],
                        "note": st["water"]["note"]})
        return {"members": out, "terms": TERMS, "plans": SUBS_PLANS}


@app.post("/api/committee/members")
def member_create(m: MemberIn, _: str = Depends(require_committee)):
    _member_validate(m)
    with db.get_conn() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO members(name, category, swim_test, subs_plan, subs_term, subs_year, cox_status,
                   past_water, past_land, active, notes, phone, phone_updated_at, college, side, squad)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ? != '' THEN datetime('now') ELSE '' END,?,?,?)""",
                (m.name.strip(), m.category, int(m.swim_test), m.subs_plan, m.subs_term, m.subs_year.strip(),
                 m.cox_status, m.past_water, m.past_land, int(m.active), m.notes, _phone_value(m.phone) or "",
                 m.phone or "", m.college.strip(), m.side, m.squad))
        except db.sqlite3.IntegrityError:
            raise HTTPException(400, "A member with that name already exists")
        return {"id": cur.lastrowid}


@app.put("/api/committee/members/{member_id}")
def member_update(member_id: int, m: MemberIn, _: str = Depends(require_committee)):
    _member_validate(m)
    with db.get_conn() as conn:
        try:
            conn.execute(
                """UPDATE members SET name=?, category=?, swim_test=?, subs_plan=?, subs_term=?, subs_year=?,
                   cox_status=?, past_water=?, past_land=?, active=?, notes=?, college=?, side=?, squad=?,
                   needs_review=0 WHERE id=?""",
                (m.name.strip(), m.category, int(m.swim_test), m.subs_plan, m.subs_term, m.subs_year.strip(),
                 m.cox_status, m.past_water, m.past_land, int(m.active), m.notes,
                 m.college.strip(), m.side, m.squad, member_id))
            new_phone = _phone_value(m.phone)
            if new_phone is not None:
                conn.execute("UPDATE members SET phone = ?, phone_updated_at = CASE WHEN ? != '' THEN datetime('now') ELSE '' END WHERE id = ?",
                             (new_phone, new_phone, member_id))
        except db.sqlite3.IntegrityError:
            raise HTTPException(400, "A member with that name already exists")
        return {"ok": True}


@app.delete("/api/committee/members/{member_id}")
def member_delete(member_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM members WHERE id=?", (member_id,))
        return {"ok": True}


# ------------------------------------------------------------------ places ----
class PlaceIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    address: str = Field("", max_length=300)
    coords: str = Field("", max_length=80)   # "51.74, -1.25" or a Google Maps link containing @lat,lon


def _parse_coords(text: str) -> tuple[Optional[float], Optional[float]]:
    import re as _re
    text = (text or "").strip()
    if not text:
        return None, None
    m = _re.search(r"@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)", text) or \
        _re.search(r"(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)", text)
    if not m:
        raise HTTPException(400, "Coordinates not recognised. Use e.g. 51.7436, -1.2521")
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(400, "Coordinates out of range")
    return lat, lon


@app.get("/api/places")
def places_list(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM places ORDER BY name")]


@app.post("/api/committee/places")
def place_create(b: PlaceIn, _: str = Depends(require_committee)):
    lat, lon = _parse_coords(b.coords)
    with db.get_conn() as conn:
        try:
            cur = conn.execute("INSERT INTO places(name, address, lat, lon) VALUES (?,?,?,?)", (b.name.strip(), b.address.strip(), lat, lon))
        except db.sqlite3.IntegrityError:
            raise HTTPException(400, "A place with that name already exists")
        return {"id": cur.lastrowid}


@app.put("/api/committee/places/{place_id}")
def place_update(place_id: int, b: PlaceIn, _: str = Depends(require_committee)):
    lat, lon = _parse_coords(b.coords)
    with db.get_conn() as conn:
        try:
            conn.execute("UPDATE places SET name=?, address=?, lat=?, lon=? WHERE id=?", (b.name.strip(), b.address.strip(), lat, lon, place_id))
        except db.sqlite3.IntegrityError:
            raise HTTPException(400, "A place with that name already exists")
        return {"ok": True}


@app.delete("/api/committee/places/{place_id}")
def place_delete(place_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM places WHERE id=?", (place_id,))
        return {"ok": True}


# ---------------------------------------------------------- subs reminders ----
@app.get("/api/committee/subs-reminders")
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


@app.put("/api/committee/subs-reminders/template")
def subs_template(b: TemplateIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        db.set_setting(conn, "subs_reminder_template", b.template.strip() or db.DEFAULT_SETTINGS["subs_reminder_template"])
        return {"ok": True}


class RemindedIn(BaseModel):
    reminded: bool = True


@app.post("/api/committee/members/{member_id}/reminded")
def member_reminded(member_id: int, b: RemindedIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("UPDATE members SET subs_reminded_at = CASE WHEN ? THEN datetime('now') ELSE '' END WHERE id = ?",
                     (int(b.reminded), member_id))
        return {"ok": True}


class PaidIn(BaseModel):
    plan: str  # "Single term" (current term) | "Full year" (current academic year)


@app.post("/api/committee/members/{member_id}/paid")
def member_paid(member_id: int, b: PaidIn, _: str = Depends(require_committee)):
    if b.plan not in ("Single term", "Full year"):
        raise HTTPException(400, "Plan must be Single term or Full year")
    with db.get_conn() as conn:
        s = db.get_settings(conn)
        conn.execute("""UPDATE members SET subs_plan = ?, subs_term = ?, subs_year = ?, subs_reminded_at = ''
                        WHERE id = ?""",
                     (b.plan, s.get("current_term", "") if b.plan == "Single term" else "", s.get("academic_year", ""), member_id))
        return {"ok": True}


@app.get("/api/committee/members/{member_id}/phone")
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


@app.delete("/api/committee/members/{member_id}/phone")
def member_phone_delete(member_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("UPDATE members SET phone = '', phone_updated_at = '' WHERE id = ?", (member_id,))
        return {"ok": True}


@app.get("/api/committee/members.csv")
def members_csv(include_phone: bool = False, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Name"] + (["Phone"] if include_phone else []) + ["College", "Side", "Category", "Swim test", "Subs plan", "Term", "Year",
                    "Subs valid", "Cox status", "Water outings", "Land sessions", "Total", "Novice free left", "Active"])
        for m in sorted(rules.members.values(), key=lambda m: m["name"].lower()):
            t = rules.totals(m["id"])
            w.writerow([m["name"]] + ([privacy.decrypt(m["phone"]) or ""] if include_phone else []) + [m["college"], m["side"], m["category"], "Yes" if m["swim_test"] else "No", m["subs_plan"], m["subs_term"],
                        m["subs_year"], "Yes" if rules.subs_valid(m) else "No", m["cox_status"], t["water"],
                        t["land"], t["total"], "" if t["novice_free_left"] is None else t["novice_free_left"],
                        "Yes" if m["active"] else "No"])
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=members.csv"})


# -------------------------------------------------------------- coaches ----
class CoachIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


@app.get("/api/committee/coaches")
def coaches_list(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT id, name FROM coaches ORDER BY name")]


@app.post("/api/committee/coaches")
def coach_create(c: CoachIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        try:
            cur = conn.execute("INSERT INTO coaches(name) VALUES (?)", (c.name.strip(),))
        except db.sqlite3.IntegrityError:
            raise HTTPException(400, "Coach already exists")
        return {"id": cur.lastrowid}


@app.put("/api/committee/coaches/{coach_id}")
def coach_update(coach_id: int, c: CoachIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("UPDATE coaches SET name=? WHERE id=?", (c.name.strip(), coach_id))
        return {"ok": True}


@app.delete("/api/committee/coaches/{coach_id}")
def coach_delete(coach_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM coaches WHERE id=?", (coach_id,))
        return {"ok": True}


@app.get("/api/committee/coaching-stats")
def coaching_stats(_: str = Depends(require_committee)):
    """Sessions per coach per month over 12 months from the season start (substring match, like the sheet)."""
    with db.get_conn() as conn:
        s = db.get_settings(conn)
        try:
            start = date.fromisoformat(s.get("season_start") or "").replace(day=1)
        except ValueError:
            t = Rules(conn).today
            start = date(t.year if t.month >= 9 else t.year - 1, 10, 1)
        months = []
        y, mo = start.year, start.month
        for _ in range(12):
            months.append(f"{y:04d}-{mo:02d}")
            mo += 1
            if mo > 12:
                y, mo = y + 1, 1
        coaches = [dict(r) for r in conn.execute("SELECT * FROM coaches ORDER BY name")]
        outings = conn.execute("SELECT date, coach FROM outings WHERE coach != '' AND cancelled = 0 AND date >= ? AND date < ?",
                               (start.isoformat(), f"{y:04d}-{mo:02d}-01")).fetchall()
        rows, uncounted = [], defaultdict(int)
        counted_any = [False] * len(outings)
        for c in coaches:
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


# -------------------------------------------------------------- outings ----
class OutingIn(BaseModel):
    kind: str = "water"
    date: str
    time: str = Field("", max_length=20)
    end_time: str = Field("", max_length=20)
    location: str = Field("", max_length=80)
    title: str = Field("", max_length=80)
    coach: str = Field("", max_length=120)
    boat_id: Optional[int] = None
    capacity: int = Field(8, ge=1, le=40)
    coxed: bool = True
    notes: str = Field("", max_length=500)
    published: Optional[bool] = None
    seats: dict[str, Optional[int]] = {}


def _times(start_text: str, end_text: str = "") -> tuple[str, str]:
    """Normalise start/end to "HH:MM"; an end time must come after the start."""
    start, end = norm_time(start_text)
    if end_text.strip():
        end = norm_time(end_text)[0]
        if to_minutes(end) is None:
            raise HTTPException(400, "End time not recognised. Use e.g. 08:00")
    if end and to_minutes(start) is not None and to_minutes(end) is not None and to_minutes(end) <= to_minutes(start):
        raise HTTPException(400, "The end time must be after the start time")
    if end and to_minutes(start) is None:
        end = ""
    return start, end


def _save_outing(conn, rules: Rules, oid: Optional[int], b: OutingIn) -> int:
    if b.kind not in ("water", "land"):
        raise HTTPException(400, "Kind must be water or land")
    try:
        date.fromisoformat(b.date)
    except ValueError:
        raise HTTPException(400, "Bad date")
    cap, coxed = b.capacity, b.coxed
    if b.kind == "water":
        if b.boat_id:
            boat = conn.execute("SELECT * FROM boats WHERE id=?", (b.boat_id,)).fetchone()
            if not boat:
                raise HTTPException(400, "Unknown boat")
            cap, coxed = boat["seats"], bool(boat["coxed"])
        cap = min(cap, 8)
    else:
        coxed = False
        b.boat_id = None
    valid_seats = set(seat_list(b.kind, cap, coxed))
    seats: dict[int, int] = {}
    seen = set()
    for k, mid in b.seats.items():
        if mid is None:
            continue
        s = int(k)
        if s not in valid_seats:
            continue
        if mid not in rules.members:
            raise HTTPException(400, "Unknown member in seat list")
        if mid in seen:
            raise HTTPException(400, f"{rules.members[mid]['name']} is in two seats")
        seen.add(mid)
        seats[s] = mid
    start, end = _times(b.time, b.end_time)
    fields = (b.kind, b.date, start, end, b.location.strip(), b.title.strip(), b.coach.strip(),
              b.boat_id, cap, int(coxed), b.notes)
    if oid is None:
        cur = conn.execute(
            """INSERT INTO outings(kind, date, time, end_time, location, title, coach, boat_id, capacity, coxed, notes, published)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", fields + (int(bool(b.published)),))
        oid = cur.lastrowid
    else:
        if not conn.execute("SELECT 1 FROM outings WHERE id=?", (oid,)).fetchone():
            raise HTTPException(404, "Outing not found")
        conn.execute(
            """UPDATE outings SET kind=?, date=?, time=?, end_time=?, location=?, title=?, coach=?, boat_id=?, capacity=?,
               coxed=?, notes=? WHERE id=?""", fields + (oid,))
        if b.published is not None:
            conn.execute("UPDATE outings SET published=? WHERE id=?", (int(b.published), oid))
    # replace seat assignments; open sub requests whose requester left the seat get cancelled
    conn.execute("DELETE FROM assignments WHERE outing_id=?", (oid,))
    for s, mid in seats.items():
        conn.execute("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?,?,?)", (oid, s, mid))
    for sr in conn.execute("SELECT * FROM sub_requests WHERE outing_id=? AND status='open'", (oid,)).fetchall():
        if seats.get(sr["seat"]) != sr["requester_id"]:
            new = seats.get(sr["seat"])
            if new:
                conn.execute("UPDATE sub_requests SET status='filled', sub_id=?, resolved_at=datetime('now') WHERE id=?",
                             (new, sr["id"]))
            else:
                conn.execute("UPDATE sub_requests SET status='cancelled', resolved_at=datetime('now') WHERE id=?", (sr["id"],))
    return oid


@app.post("/api/committee/outings")
def outing_create(b: OutingIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        return {"id": _save_outing(conn, Rules(conn), None, b)}


@app.put("/api/committee/outings/{oid}")
def outing_update(oid: int, b: OutingIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        return {"id": _save_outing(conn, Rules(conn), oid, b)}


class OutingStatusIn(BaseModel):
    status: str                                    # cancelled | scheduled (= restore)
    category: str = ""                             # cancelled only: a CANCEL_REASONS key
    reason: str = Field("", max_length=200)        # cancelled only: optional note


@app.post("/api/committee/outings/{oid}/status")
def outing_status_set(oid: int, b: OutingStatusIn, _: str = Depends(require_committee)):
    """Cancel a session or restore it. Cancelled sessions stay on the schedule with their crew, but no
    longer count towards outing totals, free outings, stats or double-booking, and open sub requests close.
    "scheduled" clears the cancellation."""
    with db.get_conn() as conn:
        o = conn.execute("SELECT date FROM outings WHERE id=?", (oid,)).fetchone()
        if not o:
            raise HTTPException(404, "Outing not found")
        if b.status == "cancelled":
            if b.category not in CANCEL_REASONS:
                raise HTTPException(400, "Pick a reason for the cancellation")
            conn.execute("UPDATE outings SET cancelled=1, cancel_category=?, cancel_reason=? WHERE id=?",
                         (b.category, b.reason.strip(), oid))
            conn.execute("""UPDATE sub_requests SET status='cancelled', resolved_at=datetime('now')
                            WHERE outing_id=? AND status='open'""", (oid,))
        elif b.status == "scheduled":
            conn.execute("UPDATE outings SET cancelled=0, cancel_category='', cancel_reason='' WHERE id=?", (oid,))
        else:
            raise HTTPException(400, "Unknown status")
        return {"ok": True}


@app.delete("/api/committee/outings/{oid}")
def outing_delete(oid: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM outings WHERE id=?", (oid,))
        return {"ok": True}


class CandidatesIn(BaseModel):
    kind: str
    date: str
    time: str = ""
    outing_id: Optional[int] = None


@app.post("/api/committee/candidates")
def candidates(b: CandidatesIn, _: str = Depends(require_committee)):
    """Eligibility of every member for a (possibly unsaved) outing — powers the seat picker."""
    with db.get_conn() as conn:
        rules = Rules(conn)
        try:
            d = date.fromisoformat(b.date)
        except ValueError:
            raise HTTPException(400, "Bad date")
        b.time = norm_time(b.time)[0]
        key = (b.date, b.time, b.outing_id or 10**12)
        busy = set()
        if b.time:
            busy = {r["member_id"] for r in conn.execute(
                """SELECT a.member_id FROM assignments a JOIN outings o ON o.id=a.outing_id
                   WHERE o.date=? AND o.time=? AND o.id != ?""", (b.date, b.time, b.outing_id or -1))}
        same_day = defaultdict(int)
        for r in conn.execute(
                """SELECT a.member_id FROM assignments a JOIN outings o ON o.id=a.outing_id
                   WHERE o.date=? AND o.id != ?""", (b.date, b.outing_id or -1)):
            same_day[r["member_id"]] += 1
        # sign-up form answers for this week + scheduled counts, to compare against their maximums
        su = availability_for_outing(conn, b.kind, b.date, b.time)
        week = week_counts(conn, monday_of(d).isoformat(), b.outing_id)
        out = {}
        for mid, m in rules.members.items():
            e = rules.check(mid, b.kind, d, key)
            out[str(mid)] = {"ok": e["ok"], "reasons": e["reasons"], "note": e["note"],
                             "busy": mid in busy, "same_day": same_day.get(mid, 0),
                             "week": week.get(mid, {"row": 0, "cox": 0, "land": 0}),
                             "signup": su["members"].get(mid)}
        return {"members": out, "has_slots": su["has_slots"]}


class WeekIn(BaseModel):
    start: str
    published: bool = True


@app.post("/api/committee/week/publish")
def week_publish(b: WeekIn, _: str = Depends(require_committee)):
    ws = monday_of(date.fromisoformat(b.start))
    with db.get_conn() as conn:
        conn.execute("UPDATE outings SET published=? WHERE date BETWEEN ? AND ?",
                     (int(b.published), ws.isoformat(), (ws + timedelta(days=6)).isoformat()))
        return {"ok": True}


class CopyWeekIn(BaseModel):
    source: str
    target: str
    include_crews: bool = False


@app.post("/api/committee/week/copy")
def week_copy(b: CopyWeekIn, _: str = Depends(require_committee)):
    src, dst = monday_of(date.fromisoformat(b.source)), monday_of(date.fromisoformat(b.target))
    if src == dst:
        raise HTTPException(400, "Source and target week are the same")
    delta = dst - src
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM outings WHERE date BETWEEN ? AND ? ORDER BY date, time, id",
                            (src.isoformat(), (src + timedelta(days=6)).isoformat())).fetchall()
        n = 0
        for o in rows:
            nd = (date.fromisoformat(o["date"]) + delta).isoformat()
            cur = conn.execute(
                """INSERT INTO outings(kind, date, time, end_time, location, title, coach, boat_id, capacity, coxed, notes, published)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,0)""",
                (o["kind"], nd, o["time"], o["end_time"], o["location"], o["title"], o["coach"], o["boat_id"], o["capacity"],
                 o["coxed"], o["notes"]))
            if b.include_crews:
                conn.execute("""INSERT INTO assignments(outing_id, seat, member_id)
                                SELECT ?, seat, member_id FROM assignments WHERE outing_id=?""", (cur.lastrowid, o["id"]))
            n += 1
        return {"copied": n}


# --------------------------------------------------------------- river ----
@app.get("/api/river")
def river_info(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        rules = Rules(conn)
        s = rules.settings
        return {
            "flag": river.current_flag(s), "rules": river.RULES_TEXT, "flags": river.FLAGS,
            "rules_page": river.RULES_PAGE, "today": river.day_info(rules.today, TZ),
            "term": river.term_info(s, rules.today), "current_term": s.get("current_term"),
            "settings": {k: s.get(k, "") for k in ("term_start", "peak_end", "peak_crews_before_8")},
        }


class RiverCheckIn(BaseModel):
    date: str
    time: str = ""
    end_time: str = ""
    coach: str = ""
    boat_id: Optional[int] = None
    capacity: int = Field(8, ge=1, le=8)
    coxed: bool = True
    seats: dict[str, Optional[int]] = {}
    outing_id: Optional[int] = None


@app.post("/api/committee/river-check")
def river_check(b: RiverCheckIn, _: str = Depends(require_committee)):
    """River-rule warnings for an outing being edited (not saved yet)."""
    try:
        date.fromisoformat(b.date)
    except ValueError:
        raise HTTPException(400, "Bad date")
    with db.get_conn() as conn:
        rules = Rules(conn)
        boat = dict(r) if b.boat_id and (r := conn.execute("SELECT * FROM boats WHERE id=?", (b.boat_id,)).fetchone()) else None
        start, end = norm_time(b.time)[0], norm_time(b.end_time)[0] if b.end_time.strip() else ""
        o = {"kind": "water", "date": b.date, "time": start, "end_time": end, "coach": b.coach,
             "capacity": boat["seats"] if boat else b.capacity, "coxed": bool(boat["coxed"]) if boat else b.coxed}
        crew = {int(k): v for k, v in b.seats.items() if v is not None and k.lstrip("-").isdigit()}
        others = [dict(r) for r in conn.execute(
            "SELECT id, kind, date, time, end_time, capacity FROM outings WHERE kind='water' AND cancelled = 0 AND date=? AND id != ?",
            (b.date, b.outing_id or -1))]
        flag = river.current_flag(rules.settings)
        return {"flag": flag, "day": river.day_info(date.fromisoformat(b.date), TZ),
                "issues": river.check_outing(o, crew, rules.members, boat, rules.settings, flag, rules.today, TZ, others)}


class RiverSettingsIn(BaseModel):
    term_start: str = ""
    peak_end: str = ""
    peak_crews_before_8: int = Field(1, ge=1, le=5)


@app.put("/api/committee/river-settings")
def river_settings(b: RiverSettingsIn, _: str = Depends(require_committee)):
    for v in (b.term_start, b.peak_end):
        if v:
            try:
                date.fromisoformat(v)
            except ValueError:
                raise HTTPException(400, f"Bad date: {v}")
    if b.term_start and date.fromisoformat(b.term_start).weekday() != 6:
        raise HTTPException(400, "Full Term starts on a Sunday (Sunday of 1st week)")
    with db.get_conn() as conn:
        db.set_setting(conn, "term_start", b.term_start)
        db.set_setting(conn, "peak_end", b.peak_end)
        db.set_setting(conn, "peak_crews_before_8", str(b.peak_crews_before_8))
    return {"ok": True}


@app.post("/api/committee/river/refresh")
def river_refresh(_: str = Depends(require_committee)):
    river.refresh_now(db)
    with db.get_conn() as conn:
        return river.current_flag(db.get_settings(conn))


# ------------------------------------------------------------- settings ----
class SettingsIn(BaseModel):
    club_name: str = Field("Reuben Boat Club", max_length=80)
    academic_year: str = Field(..., max_length=20)
    current_term: str
    subs_cutoff: str = ""
    today_override: str = ""
    novice_free_outings: int = Field(4, ge=0, le=50)
    novice_land_free: bool = True
    season_start: str = ""
    member_password: str = Field("", max_length=200)
    phone_mode: str = "required"
    phone_retention_days: int = Field(180, ge=0, le=3650)
    swim_test_after: Optional[int] = Field(None, ge=0, le=50)   # None = keep current


@app.get("/api/committee/settings")
def settings_get(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        s = db.get_settings(conn)
        s["member_password_custom"] = bool(s.pop("member_password_hash", ""))
        s["novice_land_free"] = s.get("novice_land_free") == "1"
        s["novice_free_outings"] = int(s.get("novice_free_outings") or 0)
        s["terms"] = TERMS
        s["swim_test_after"] = int(s.get("swim_test_after") or 0)
        s["phone_encryption"] = privacy.enabled()
        s["phone_retention_days"] = int(s.get("phone_retention_days") or 0)
        s["phone_count"] = conn.execute("SELECT COUNT(*) FROM members WHERE phone != ''").fetchone()[0]
        return s


@app.put("/api/committee/settings")
def settings_put(b: SettingsIn, _: str = Depends(require_committee)):
    if b.current_term not in TERMS:
        raise HTTPException(400, "Bad term")
    for v in (b.subs_cutoff, b.today_override, b.season_start):
        if v:
            try:
                date.fromisoformat(v)
            except ValueError:
                raise HTTPException(400, f"Bad date: {v}")
    if b.phone_mode not in ("required", "optional", "off"):
        raise HTTPException(400, "Bad phone setting")
    with db.get_conn() as conn:
        db.set_setting(conn, "phone_mode", b.phone_mode)
        if b.swim_test_after is not None:
            db.set_setting(conn, "swim_test_after", str(b.swim_test_after))
        db.set_setting(conn, "phone_retention_days", str(b.phone_retention_days))
        privacy.purge_expired(conn, b.phone_retention_days)
        for k in ("club_name", "academic_year", "current_term", "subs_cutoff", "today_override", "season_start"):
            db.set_setting(conn, k, getattr(b, k).strip())
        db.set_setting(conn, "novice_free_outings", str(b.novice_free_outings))
        db.set_setting(conn, "novice_land_free", "1" if b.novice_land_free else "0")
        if b.member_password:
            if len(b.member_password) < 6:
                raise HTTPException(400, "Member password must be at least 6 characters")
            if hmac.compare_digest(b.member_password.encode(), COMMITTEE_PASSWORD.encode()):
                raise HTTPException(400, "Rower password must differ from the committee password")
            db.set_setting(conn, "member_password_hash", _hash_pw(b.member_password))
        return {"ok": True}


@app.post("/api/committee/settings/reset-member-password")
def settings_reset_pw(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        db.set_setting(conn, "member_password_hash", "")
        return {"ok": True}


@app.get("/api/committee/backup")
def backup(_: str = Depends(require_committee)):
    """Download a consistent snapshot of the SQLite database."""
    path = os.path.join(db.DATA_DIR, "backup.db")
    src = db.connect()
    try:
        dst = db.sqlite3.connect(path)
        src.backup(dst)
        dst.close()
    finally:
        src.close()
    return FileResponse(path, filename=f"outings-backup-{date.today().isoformat()}.db",
                        media_type="application/octet-stream")


# -------------------------------------------------------------- static ----
@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.exception_handler(HTTPException)
async def http_exc(_, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


app.include_router(signup_router)
app.include_router(calendar_router)
app.include_router(stats_router)
app.include_router(races_router)
app.include_router(issues.router)
app.include_router(roster_router)
app.include_router(tasks_router)
app.include_router(autofill_router)
app.include_router(usage_router)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})
