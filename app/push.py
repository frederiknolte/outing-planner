"""Web push notifications: tells rowers about things without them opening the app.

Alerts
  * Crew published: an outing you're in goes from draft to published.
  * You got a seat: someone else puts you in an already-published outing (the committee edits the
    crew, autofill fills an empty seat, or a rower hands you their seat as their sub).
  * Your sub was filled: someone takes the seat you asked a sub for.
  * Red / Black flag: the Isis flag is Red or Black and you have a water outing in the next 18 hours.
    Checked whenever the flag is fetched (hourly); each outing is warned once per flag.

Nobody signs in individually (everyone shares a password), so a device subscribes for the rower whose
name was picked on it, the same trust model as the personal calendar feed.

The protocol is implemented here with `cryptography` (already a dependency) instead of pywebpush:
  * RFC 8291 message encryption (aes128gcm), RFC 8292 VAPID (ES256 JWT), RFC 8030 delivery.
The VAPID key pair is generated on first use and kept in DATA_DIR/.vapid_key.pem. If it's lost,
existing subscriptions stop working; the app quietly re-subscribes each device on its next visit.
Endpoints are restricted to the big browser push services, so the server never posts to arbitrary URLs.
"""
from __future__ import annotations

import base64
import json
import os
import queue
import struct
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, hmac, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import db
from .auth import require_member
from .logic import TZ, seat_label
from .timeutil import to_minutes

router = APIRouter()

# Browser push services (Chrome/Android, Firefox, Safari/iOS, Edge on Windows).
PUSH_HOSTS = ("fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com",
              "push.apple.com", "notify.windows.com")
MAX_PER_MEMBER = 10           # devices per rower; the oldest go first
FLAG_WINDOW_H = 18            # warn about outings starting within this many hours
FLAG_KEYS = ("red", "black")
UNTIMED_START = "12:00"       # an outing without a start time counts as starting at noon
DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ------------------------------------------------------------- helpers ----
def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def allowed_endpoint(url: str) -> bool:
    try:
        u = urlparse(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and not u.port and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


# ---------------------------------------------------------------- VAPID ----
_key_lock = threading.Lock()
_key: Optional[ec.EllipticCurvePrivateKey] = None


def _private_key() -> ec.EllipticCurvePrivateKey:
    global _key
    with _key_lock:
        if _key is None:
            path = os.path.join(db.DATA_DIR, ".vapid_key.pem")
            if os.path.exists(path):
                with open(path, "rb") as f:
                    _key = serialization.load_pem_private_key(f.read(), password=None)
            else:
                _key = ec.generate_private_key(ec.SECP256R1())
                pem = _key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                         serialization.NoEncryption())
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(pem)
        return _key


def public_key() -> str:
    """The application server key browsers subscribe with (base64url, uncompressed P-256 point)."""
    return b64u(_private_key().public_key().public_bytes(serialization.Encoding.X962,
                                                         serialization.PublicFormat.UncompressedPoint))


def _subject() -> str:
    s = os.environ.get("VAPID_SUBJECT") or os.environ.get("PUBLIC_URL") or ""
    if not s:
        with db.get_conn() as conn:
            s = db.get_settings(conn).get("push_origin", "")
    return s if s.startswith(("https://", "mailto:")) else "mailto:outings@example.org"


def vapid_header(endpoint: str, subject: str) -> str:
    u = urlparse(endpoint)
    seg = lambda d: b64u(json.dumps(d, separators=(",", ":")).encode())  # noqa: E731
    signing = seg({"typ": "JWT", "alg": "ES256"}) + "." + seg(
        {"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": subject})
    r, s = decode_dss_signature(_private_key().sign(signing.encode(), ec.ECDSA(hashes.SHA256())))
    jwt = signing + "." + b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={jwt}, k={public_key()}"


# ----------------------------------------------------------- encryption ----
def _hmac(key: bytes, data: bytes) -> bytes:
    h = hmac.HMAC(key, hashes.SHA256())
    h.update(data)
    return h.finalize()


def encrypt(plaintext: bytes, p256dh: str, auth: str) -> bytes:
    """RFC 8291: encrypt a message for one subscription (a single aes128gcm record)."""
    ua_pub = unb64u(p256dh)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub)
    as_priv = ec.generate_private_key(ec.SECP256R1())
    as_pub = as_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = as_priv.exchange(ec.ECDH(), ua_key)
    ikm = _hmac(_hmac(unb64u(auth), shared), b"WebPush: info\x00" + ua_pub + as_pub + b"\x01")
    salt = os.urandom(16)
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
    body = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    return salt + struct.pack("!IB", 4096, len(as_pub)) + as_pub + body


# -------------------------------------------------------------- sending ----
def _post(url: str, headers: dict, body: bytes) -> int:
    """POST to a push service; returns the HTTP status. Replaced in tests."""
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 - endpoint host is allow-listed
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def send_to_subscription(sub: dict, payload: dict, ttl: int = 12 * 3600, urgency: str = "normal",
                         subject: Optional[str] = None) -> int:
    body = encrypt(json.dumps(payload).encode(), sub["p256dh"], sub["auth"])
    headers = {
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        "TTL": str(max(0, int(ttl))), "Urgency": urgency,
        "Authorization": vapid_header(sub["endpoint"], subject or _subject()),
    }
    return _post(sub["endpoint"], headers, body)


def deliver(member_ids, payload: dict, ttl: int = 12 * 3600, urgency: str = "normal") -> int:
    """Send to every device of these rowers now. Drops subscriptions the push service has expired."""
    ids = sorted(set(member_ids))
    if not ids:
        return 0
    with db.get_conn() as conn:
        subs = [dict(r) for r in conn.execute(
            f"SELECT * FROM push_subscriptions WHERE member_id IN ({','.join('?' * len(ids))})", ids)]
    if not subs:
        return 0
    subject, ok, gone = _subject(), [], []
    for s in subs:
        try:
            status = send_to_subscription(s, payload, ttl, urgency, subject)
        except Exception as e:  # noqa: BLE001 - one bad device mustn't stop the rest
            print(f"[push] send failed: {type(e).__name__}: {e}", flush=True)
            continue
        if 200 <= status < 300:
            ok.append(s["id"])
        elif status in (404, 410):
            gone.append(s["id"])
        else:
            print(f"[push] {urlparse(s['endpoint']).hostname} answered {status}", flush=True)
    with db.get_conn() as conn:
        for sid in gone:
            conn.execute("DELETE FROM push_subscriptions WHERE id = ?", (sid,))
        if ok:
            conn.execute(f"UPDATE push_subscriptions SET last_used_at = datetime('now') WHERE id IN ({','.join('?' * len(ok))})", ok)
    return len(ok)


_queue: "queue.Queue[tuple]" = queue.Queue()
_worker: Optional[threading.Thread] = None
_worker_lock = threading.Lock()


def _work():
    while True:
        member_ids, payload, ttl, urgency = _queue.get()
        try:
            deliver(member_ids, payload, ttl, urgency)
        except Exception as e:  # noqa: BLE001 - never let the worker die
            print(f"[push] delivery failed: {type(e).__name__}: {e}", flush=True)
        finally:
            _queue.task_done()


def dispatch(messages: list[dict]) -> None:
    """Queue messages for sending in the background. Call after the database change is committed."""
    global _worker
    if not messages:
        return
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_work, name="push", daemon=True)
            _worker.start()
    for m in messages:
        _queue.put((m["to"], m["payload"], m.get("ttl", 12 * 3600), m.get("urgency", "normal")))


def _msg(to, title: str, body: str, tag: str, url: str = "/#/me", **extra) -> dict:
    return {"to": list(to), "payload": {"title": title, "body": body, "tag": tag, "url": url}, **extra}


# ------------------------------------------------------------- wording ----
def _when(o) -> str:
    d = date.fromisoformat(o["date"])
    return f"{DAY[d.weekday()]} {d.day} {MON[d.month - 1]}" + (f" {o['time']}" if o["time"] else "")


def describe(o, boat: Optional[str] = None) -> str:
    """'Tue 5 Nov 07:00 · Isis' / 'Thu 7 Nov 18:00 · Erg session'"""
    if o["kind"] == "water":
        what = o["title"] or boat or "Water outing"
    else:
        what = o["title"] or o["location"] or "Land session"
    return f"{_when(o)} · {what}"


def _seat(o, seat: int) -> str:
    lab = seat_label(seat, o["capacity"], o["kind"])
    if o["kind"] == "land":
        return ""
    return f"Seat {lab}" if lab.isdigit() else lab


def _boat_names(conn) -> dict:
    return {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM boats")}


def _today() -> date:
    return datetime.now(TZ).date()


# -------------------------------------------------- crew changes (diff) ----
def snapshot(conn, ids=None, start: Optional[str] = None, end: Optional[str] = None) -> dict:
    """Upcoming outings (by id list or date range) with who sits where, to compare before/after a change."""
    where, params = ["date >= ?"], [_today().isoformat()]
    if ids is not None:
        ids = list(ids)
        if not ids:
            return {}
        where.append(f"id IN ({','.join('?' * len(ids))})")
        params += ids
    if start:
        where.append("date >= ?")
        params.append(start)
    if end:
        where.append("date <= ?")
        params.append(end)
    out = {r["id"]: {"row": dict(r), "seats": {}} for r in conn.execute(
        f"SELECT * FROM outings WHERE {' AND '.join(where)}", params)}
    if out:
        qs = ",".join("?" * len(out))
        for a in conn.execute(f"SELECT outing_id, seat, member_id FROM assignments WHERE outing_id IN ({qs})", list(out)):
            out[a["outing_id"]]["seats"][a["member_id"]] = a["seat"]
    return out


def crew_changes(conn, before: dict, extra_ids=(), actor: Optional[int] = None) -> list[dict]:
    """Messages for crews that were just published and for rowers newly put in a published outing.
    `actor` is a rower who made the change themselves (they don't need telling)."""
    after = snapshot(conn, ids=set(before) | set(extra_ids))
    boats = _boat_names(conn)
    published: dict[int, list] = defaultdict(list)
    seated: list[tuple[int, dict, int]] = []
    for oid, a in after.items():
        o = a["row"]
        if not o["published"] or o["cancelled"]:
            continue
        b = before.get(oid)
        if not b or not b["row"]["published"]:
            for mid, seat in a["seats"].items():
                published[mid].append((o, seat))
        else:
            for mid, seat in a["seats"].items():
                if mid not in b["seats"] and mid != actor:
                    seated.append((mid, o, seat))
    msgs = []
    for mid, items in published.items():
        items.sort(key=lambda x: (x[0]["date"], x[0]["time"]))
        if len(items) == 1:
            o, seat = items[0]
            body = describe(o, boats.get(o["boat_id"])) + (f" · {_seat(o, seat)}" if _seat(o, seat) else "")
            title = "Your crew is out" if o["kind"] == "water" else "You're booked in"
            msgs.append(_msg([mid], title, body, f"pub-{o['id']}"))
        else:
            lines = [describe(o, boats.get(o["boat_id"])) for o, _ in items]
            body = "\n".join(lines[:4]) + (f"\n+{len(lines) - 4} more" if len(lines) > 4 else "")
            msgs.append(_msg([mid], f"You're in {len(items)} sessions", body, f"pub-{items[0][0]['date']}"))
    for mid, o, seat in seated:
        body = describe(o, boats.get(o["boat_id"])) + (f" · {_seat(o, seat)}" if _seat(o, seat) else "")
        msgs.append(_msg([mid], "You've got a seat", body, f"seat-{o['id']}"))
    return msgs


def sub_filled(conn, outing_id: int, requester_id: int, sub_id: int) -> list[dict]:
    """Tell the rower who asked for a sub that someone took their seat."""
    o = conn.execute("SELECT * FROM outings WHERE id = ?", (outing_id,)).fetchone()
    m = conn.execute("SELECT name FROM members WHERE id = ?", (sub_id,)).fetchone()
    if not o or not m or o["cancelled"]:
        return []
    boat = _boat_names(conn).get(o["boat_id"])
    return [_msg([requester_id], "Your sub is covered", f"{m['name']} is taking your seat: {describe(o, boat)}",
                 f"sub-{outing_id}")]


# ------------------------------------------------------------ river flag ----
def check_flag(now: Optional[datetime] = None) -> int:
    """If the Isis flag is Red or Black, warn crews of water outings starting within FLAG_WINDOW_H hours.
    Each outing is warned once per flag (kept in push_sent). Returns the number of outings warned."""
    from . import river
    now = now or datetime.now(TZ)
    msgs = []
    with db.get_conn() as conn:
        conn.execute("DELETE FROM push_sent WHERE sent_at < datetime('now', '-60 days')")
        flag = river.current_flag(db.get_settings(conn))
        if flag["key"] not in FLAG_KEYS or flag["stale"]:
            return 0
        horizon = now + timedelta(hours=FLAG_WINDOW_H)
        rows = conn.execute(
            """SELECT * FROM outings WHERE kind = 'water' AND published = 1 AND cancelled = 0
               AND date BETWEEN ? AND ?""", (now.date().isoformat(), horizon.date().isoformat())).fetchall()
        boats = _boat_names(conn)
        for o in rows:
            mins = to_minutes(o["time"] or "")
            if mins is None:
                mins = to_minutes(UNTIMED_START)
            start = datetime.combine(date.fromisoformat(o["date"]), datetime.min.time(), TZ) + timedelta(minutes=mins)
            if not (now <= start <= horizon):
                continue
            crew = [r["member_id"] for r in conn.execute("SELECT member_id FROM assignments WHERE outing_id = ?", (o["id"],))]
            if not crew:
                continue
            key = f"flag:{o['id']}:{flag['key']}:{flag.get('set_date') or ''}"
            if not conn.execute("INSERT OR IGNORE INTO push_sent(key) VALUES (?)", (key,)).rowcount:
                continue
            msgs.append(_msg(crew, f"{flag['name']} flag on the Isis",
                             f"No crews allowed out. Your outing {describe(o, boats.get(o['boat_id']))} is affected: "
                             "watch for a cancellation from the committee.",
                             f"flag-{o['id']}", ttl=max(60, int((start - now).total_seconds())), urgency="high"))
    dispatch(msgs)
    return len(msgs)


# ------------------------------------------------------------------ API ----
class SubKeys(BaseModel):
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(..., max_length=1000)
    keys: SubKeys


class SubscribeIn(BaseModel):
    member_id: int
    subscription: SubscriptionIn


class EndpointIn(BaseModel):
    endpoint: str = Field(..., max_length=1000)


@router.get("/api/push/key")
def push_key(_: str = Depends(require_member)):
    return {"key": public_key()}


@router.post("/api/push/subscribe")
def push_subscribe(b: SubscribeIn, request: Request, _: str = Depends(require_member)):
    s = b.subscription
    if not allowed_endpoint(s.endpoint):
        raise HTTPException(400, "This browser's push service isn't supported")
    try:
        if len(unb64u(s.keys.p256dh)) != 65 or len(unb64u(s.keys.auth)) != 16:
            raise ValueError
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64u(s.keys.p256dh))
    except ValueError:
        raise HTTPException(400, "Invalid subscription keys")
    origin = request.headers.get("origin", "")
    with db.get_conn() as conn:
        if not conn.execute("SELECT 1 FROM members WHERE id = ?", (b.member_id,)).fetchone():
            raise HTTPException(400, "Unknown member")
        conn.execute(
            """INSERT INTO push_subscriptions(member_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
               ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh,
               auth = excluded.auth""", (b.member_id, s.endpoint, s.keys.p256dh, s.keys.auth))
        conn.execute(
            """DELETE FROM push_subscriptions WHERE member_id = ? AND id NOT IN
               (SELECT id FROM push_subscriptions WHERE member_id = ? ORDER BY id DESC LIMIT ?)""",
            (b.member_id, b.member_id, MAX_PER_MEMBER))
        if origin.startswith("https://") and not db.get_settings(conn).get("push_origin"):
            db.set_setting(conn, "push_origin", origin[:200])
    return {"ok": True}


@router.post("/api/push/unsubscribe")
def push_unsubscribe(b: EndpointIn, _: str = Depends(require_member)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (b.endpoint,))
    return {"ok": True}


@router.post("/api/push/test")
def push_test(b: EndpointIn, _: str = Depends(require_member)):
    """Send a test notification to this device, synchronously, so the app can say whether it worked."""
    with db.get_conn() as conn:
        s = conn.execute("SELECT * FROM push_subscriptions WHERE endpoint = ?", (b.endpoint,)).fetchone()
    if not s:
        raise HTTPException(404, "This device isn't signed up for notifications")
    try:
        status = send_to_subscription(dict(s), {"title": "Notifications are on",
                                                "body": "You'll hear about crews, subs, seats and red flags here.",
                                                "tag": "test", "url": "/#/me"}, ttl=600)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Couldn't reach the push service ({type(e).__name__})")
    if status in (404, 410):
        with db.get_conn() as conn:
            conn.execute("DELETE FROM push_subscriptions WHERE id = ?", (s["id"],))
        raise HTTPException(410, "This device's subscription has expired. Turn notifications off and on again")
    if not 200 <= status < 300:
        raise HTTPException(502, f"The push service answered {status}")
    return {"ok": True}
