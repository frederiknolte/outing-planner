"""Change log for published crews and sub requests.

Rowers only pick their name on the device, so anyone could leave, join or swap a seat as
someone else. Every change to the crew of a published outing (and every sub request posted
or withdrawn) is recorded with who made it, what changed and when, the way task_updates
works for the to-do list. Each outing shows its log ("Alex left seat 3 · Tue 21:04"), and the
committee can undo a bad entry.

"Who" is the name picked on the device that made the change (sent as the X-Acting-As
header), plus whether it was signed in as the committee. Changes made while an outing is
still a draft aren't logged: that's the committee building the crew, not a change to it.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from . import db, push
from .auth import require_committee, role_of
from .logic import seat_label, seat_list

router = APIRouter()

SEAT_ACTIONS = ("join", "leave", "replace", "move", "swap")
SUB_SOURCES = ("sub_fill", "sub_handover")


# ------------------------------------------------------------- recording ----
def actor(request: Request, conn, fallback: Optional[int] = None) -> dict:
    """Who is making this request: the rower picked on the device (X-Acting-As), or `fallback`
    (the member id in the request body) for older clients that don't send the header."""
    mid = None
    raw = (request.headers.get("X-Acting-As") or "").strip()
    if raw.isdigit():
        mid = int(raw)
    elif fallback is not None:
        mid = fallback
    row = conn.execute("SELECT id, name FROM members WHERE id = ?", (mid,)).fetchone() if mid else None
    return {"id": row["id"] if row else None, "name": row["name"] if row else "",
            "role": "committee" if role_of(request) == "committee" else "member"}


def _seats(conn, oid: int) -> dict[int, int]:
    return {r["seat"]: r["member_id"] for r in conn.execute("SELECT seat, member_id FROM assignments WHERE outing_id = ?", (oid,))}


def state(conn, oid: Optional[int]) -> Optional[dict]:
    """The outing's crew before a change; pass it to record() afterwards."""
    if not oid:
        return None
    o = conn.execute("SELECT published FROM outings WHERE id = ?", (oid,)).fetchone()
    return {"published": bool(o["published"]), "seats": _seats(conn, oid)} if o else None


def diff(before: dict[int, int], after: dict[int, int]) -> list[dict]:
    """Seat changes between two {seat: member_id} maps, as log events."""
    bm = {m: s for s, m in before.items()}
    am = {m: s for s, m in after.items()}
    moved = {m: (bm[m], am[m]) for m in bm.keys() & am.keys() if bm[m] != am[m]}
    left = set(bm) - set(am)
    joined = set(am) - set(bm)
    out = []
    for m in sorted(moved):                                  # two rowers trading seats
        if m not in moved:
            continue
        a, b = moved[m]
        n = after.get(a)
        if n is not None and n != m and moved.get(n) == (b, a):
            out.append({"action": "swap", "member_id": m, "other_id": n, "seat": b, "from_seat": a})
            del moved[m], moved[n]
    for s in sorted(after):                                  # someone new in a seat someone left
        old, new = before.get(s), after[s]
        if old in left and new in joined:
            out.append({"action": "replace", "member_id": new, "other_id": old, "seat": s})
            left.discard(old)
            joined.discard(new)
    for m, (a, b) in sorted(moved.items(), key=lambda x: x[1][1]):
        out.append({"action": "move", "member_id": m, "seat": b, "from_seat": a})
    for m in sorted(left, key=lambda m: bm[m]):
        out.append({"action": "leave", "member_id": m, "seat": bm[m]})
    for m in sorted(joined, key=lambda m: am[m]):
        out.append({"action": "join", "member_id": m, "seat": am[m]})
    return out


def _name(conn, mid: Optional[int]) -> str:
    if not mid:
        return ""
    r = conn.execute("SELECT name FROM members WHERE id = ?", (mid,)).fetchone()
    return r["name"] if r else ""


def add(conn, oid: int, ev: dict, who: dict, source: str, sub_request_id: Optional[int] = None, note: str = "") -> int:
    return conn.execute(
        """INSERT INTO crew_log(outing_id, action, member_id, member_name, other_id, other_name, seat, from_seat,
               sub_request_id, note, source, by_id, by_name, by_role) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (oid, ev["action"], ev.get("member_id"), _name(conn, ev.get("member_id")), ev.get("other_id"),
         _name(conn, ev.get("other_id")), ev.get("seat"), ev.get("from_seat"), sub_request_id, note[:300], source,
         who.get("id"), who.get("name", ""), who.get("role", ""))).lastrowid


def record(conn, oid: int, before: Optional[dict], who: dict, source: str, sub_request_id: Optional[int] = None,
           note: str = "", force: bool = False) -> int:
    """Log how the crew changed since `before` (from state()). Only published outings are logged,
    unless `force`. Returns the number of entries written."""
    if not before or not (before["published"] or force):
        return 0
    events = diff(before["seats"], _seats(conn, oid))
    for ev in events:
        add(conn, oid, ev, who, source, sub_request_id, note)
    return len(events)


def sub_event(conn, oid: int, action: str, sub_request_id: int, who: dict, source: str = "", note: str = "") -> None:
    """Log a sub request posted (sub_request) or withdrawn (sub_cancel) on a published outing."""
    o = conn.execute("SELECT published FROM outings WHERE id = ?", (oid,)).fetchone()
    sr = conn.execute("SELECT * FROM sub_requests WHERE id = ?", (sub_request_id,)).fetchone()
    if not o or not sr or not o["published"]:
        return
    add(conn, oid, {"action": action, "member_id": sr["requester_id"], "seat": sr["seat"]}, who,
        source or action, sub_request_id, note)


# --------------------------------------------------------------- reading ----
def _seat_text(seat, cap: int, kind: str) -> str:
    if seat is None or kind == "land":
        return ""
    lab = seat_label(seat, cap, kind)
    return {"Cox": "the cox seat", "Bow": "bow seat", "Stroke": "stroke seat", "Sculler": "the single"}.get(lab, f"seat {lab}")


def _short_seat(seat, cap: int, kind: str) -> str:
    return seat_label(seat, cap, kind) if seat is not None else "?"


def describe(e: dict, cap: int, kind: str) -> str:
    m = e["member_name"] or "A deleted member"
    n = e["other_name"] or "a deleted member"
    st = _seat_text(e["seat"], cap, kind)
    at = f" {st}" if st else ""
    a = e["action"]
    if a == "join":
        return f"{m} took {st}" if st else f"{m} joined"
    if a == "leave":
        return f"{m} left {st}" if st else f"{m} left"
    if a == "replace":
        if e["source"] in SUB_SOURCES:
            return f"{m} subbed in for {n}" + (f" ({st})" if st else "")
        return f"{m} replaced {n}{' in ' + st if st else ''}"
    if a == "move":
        return f"{m} moved from {_seat_text(e['from_seat'], cap, kind)} to {st}"
    if a == "swap":
        return f"{m} and {n} swapped seats ({_short_seat(e['from_seat'], cap, kind)} ↔ {_short_seat(e['seat'], cap, kind)})"
    if a == "sub_request":
        return f"{m} asked for a sub" + (f" for {st}" if st else "")
    if a == "sub_cancel":
        return f"{m}'s sub request" + (f" for {st}" if st else "") + " was withdrawn"
    return a


def by_label(name: str, role: str) -> str:
    if role == "committee":
        return f"{name} (committee)" if name else "the committee"
    return name or "someone who hadn't picked a name"


def entry(e: dict, cap: int, kind: str) -> dict:
    """One log entry for the client. `by` is only set when someone other than the rower whose seat
    changed made the change, so "Alex left seat 3" means Alex did it themselves."""
    self_made = e["by_role"] != "committee" and e["by_id"] is not None and e["by_id"] == e["member_id"]
    return {"id": e["id"], "action": e["action"], "text": describe(e, cap, kind), "note": e["note"],
            "by": "" if self_made else by_label(e["by_name"], e["by_role"]), "by_role": e["by_role"], "source": e["source"],
            "created_at": e["created_at"], "undone_at": e["undone_at"], "undone_by": e["undone_by"]}


def for_outings(conn, outings: list[dict]) -> dict[int, list[dict]]:
    """{outing_id: [entries, oldest first]} for a list of outing rows."""
    if not outings:
        return {}
    by_id = {o["id"]: o for o in outings}
    qs = ",".join("?" * len(by_id))
    out: dict[int, list[dict]] = {oid: [] for oid in by_id}
    for r in conn.execute(f"SELECT * FROM crew_log WHERE outing_id IN ({qs}) ORDER BY created_at, id", list(by_id)):
        o = by_id[r["outing_id"]]
        out[r["outing_id"]].append(entry(dict(r), o["capacity"], o["kind"]))
    return out


# ------------------------------------------------------------------ undo ----
def _cleanup_subs(conn, oid: int) -> None:
    """Open sub requests whose requester is no longer in that seat are closed (as when the committee edits a crew)."""
    seats = _seats(conn, oid)
    for sr in conn.execute("SELECT * FROM sub_requests WHERE outing_id = ? AND status = 'open'", (oid,)).fetchall():
        if seats.get(sr["seat"]) != sr["requester_id"]:
            conn.execute("UPDATE sub_requests SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ?", (sr["id"],))


@router.post("/api/committee/crew-log/{entry_id}/undo")
def undo(entry_id: int, request: Request, _: str = Depends(require_committee)):
    """Reverse one log entry, if the crew still looks the way that entry left it."""
    with db.get_conn() as conn:
        e = conn.execute("SELECT * FROM crew_log WHERE id = ?", (entry_id,)).fetchone()
        if not e:
            raise HTTPException(404, "Change not found")
        if e["undone_at"]:
            raise HTTPException(400, "This change has already been undone")
        o = conn.execute("SELECT * FROM outings WHERE id = ?", (e["outing_id"],)).fetchone()
        oid, cap, kind = o["id"], o["capacity"], o["kind"]
        who = actor(request, conn)
        seats = _seats(conn, oid)
        where = {m: s for s, m in seats.items()}
        m, n, s, f = e["member_id"], e["other_id"], e["seat"], e["from_seat"]
        mname, nname = e["member_name"] or "That rower", e["other_name"] or "That rower"

        def occupant(seat):
            return _name(conn, seats.get(seat)) or "someone else"

        def free_seat(want):
            """The seat to put someone back in: the same one, or for land sessions any free spot."""
            if kind == "land":
                if want is not None and want not in seats and 1 <= want <= cap:
                    return want
                free = [x for x in range(1, cap + 1) if x not in seats]
                if not free:
                    raise HTTPException(409, "The session is full, so they can't be put back")
                return free[0]
            if want not in seat_list(kind, cap, bool(o["coxed"])):
                raise HTTPException(409, "That seat no longer exists in this boat")
            if want in seats:
                raise HTTPException(409, f"{_seat_text(want, cap, kind).capitalize()} is now taken by {occupant(want)}")
            return want

        before = state(conn, oid)
        pushed = push.snapshot(conn, ids=[oid])
        a = e["action"]
        if a in SEAT_ACTIONS and m is None:
            raise HTTPException(409, "The rower in this change has been deleted")
        if a == "join":
            if seats.get(s) != m:
                raise HTTPException(409, f"{mname} isn't in that seat any more")
            conn.execute("DELETE FROM assignments WHERE outing_id = ? AND member_id = ?", (oid, m))
        elif a == "leave":
            if m in where:
                raise HTTPException(409, f"{mname} is already back in this outing")
            conn.execute("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?, ?, ?)", (oid, free_seat(s), m))
        elif a == "replace":
            if n is None:
                raise HTTPException(409, "The rower who left has been deleted")
            if seats.get(s) != m:
                raise HTTPException(409, f"{mname} isn't in that seat any more")
            if n in where:
                raise HTTPException(409, f"{nname} is already in this outing in another seat")
            conn.execute("UPDATE assignments SET member_id = ? WHERE outing_id = ? AND seat = ?", (n, oid, s))
            sr = conn.execute("SELECT * FROM sub_requests WHERE id = ?", (e["sub_request_id"],)).fetchone() if e["sub_request_id"] else None
            if sr and sr["status"] == "filled" and sr["sub_id"] == m:
                if e["source"] == "sub_fill" and not conn.execute(
                        "SELECT 1 FROM sub_requests WHERE outing_id = ? AND seat = ? AND status = 'open'", (oid, s)).fetchone():
                    # the request was real but the wrong person took it: back on the sub board
                    conn.execute("UPDATE sub_requests SET status = 'open', sub_id = NULL, resolved_at = NULL WHERE id = ?", (sr["id"],))
                else:
                    conn.execute("UPDATE sub_requests SET status = 'cancelled', sub_id = NULL WHERE id = ?", (sr["id"],))
        elif a == "move":
            if seats.get(s) != m:
                raise HTTPException(409, f"{mname} isn't in that seat any more")
            back = free_seat(f)
            conn.execute("UPDATE assignments SET seat = ? WHERE outing_id = ? AND member_id = ?", (back, oid, m))
        elif a == "swap":
            if seats.get(s) != m or seats.get(f) != n:
                raise HTTPException(409, f"{mname} and {nname} aren't in those seats any more")
            conn.execute("DELETE FROM assignments WHERE outing_id = ? AND member_id IN (?, ?)", (oid, m, n))
            conn.executemany("INSERT INTO assignments(outing_id, seat, member_id) VALUES (?, ?, ?)", [(oid, f, m), (oid, s, n)])
        elif a == "sub_request":
            sr = conn.execute("SELECT * FROM sub_requests WHERE id = ?", (e["sub_request_id"],)).fetchone()
            if not sr or sr["status"] != "open":
                raise HTTPException(409, "This sub request isn't open any more. If someone took the seat, undo that change instead")
            conn.execute("UPDATE sub_requests SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ?", (sr["id"],))
            add(conn, oid, {"action": "sub_cancel", "member_id": sr["requester_id"], "seat": sr["seat"]}, who, "undo", sr["id"])
        elif a == "sub_cancel":
            sr = conn.execute("SELECT * FROM sub_requests WHERE id = ?", (e["sub_request_id"],)).fetchone()
            if not sr or sr["status"] != "cancelled":
                raise HTTPException(409, "This sub request can't be reopened")
            if seats.get(sr["seat"]) != sr["requester_id"]:
                raise HTTPException(409, f"{mname} isn't in that seat any more")
            if conn.execute("SELECT 1 FROM sub_requests WHERE outing_id = ? AND seat = ? AND status = 'open'", (oid, sr["seat"])).fetchone():
                raise HTTPException(409, "There's already an open sub request for that seat")
            conn.execute("UPDATE sub_requests SET status = 'open', resolved_at = NULL WHERE id = ?", (sr["id"],))
            add(conn, oid, {"action": "sub_request", "member_id": sr["requester_id"], "seat": sr["seat"]}, who, "undo", sr["id"])
        else:
            raise HTTPException(400, "This change can't be undone")
        if a in SEAT_ACTIONS:
            _cleanup_subs(conn, oid)
            record(conn, oid, before, who, "undo", force=True)
        conn.execute("UPDATE crew_log SET undone_at = datetime('now'), undone_by = ? WHERE id = ?", (by_label(who["name"], who["role"]), entry_id))
        msgs = push.crew_changes(conn, pushed)
    push.dispatch(msgs)
    return {"ok": True}
