"""Phone-number protection: encryption at rest, masking and automatic deletion.

* Numbers are stored encrypted ("enc:v1:<token>", Fernet = AES-128-CBC + HMAC-SHA256).
  The key comes from the PHONE_KEY environment variable and is never written to the
  data folder, so a copy of the database or a backup contains no readable numbers.
* Without PHONE_KEY the app does not store phone numbers at all (the sign-up form
  stops asking). Losing the key makes stored numbers unreadable; they can simply be
  collected again.
* Key rotation: set the new key as PHONE_KEY and the old one as PHONE_KEY_OLD; all
  numbers are re-encrypted with the new key on start-up.
* Retention: a number is deleted once its owner hasn't signed up (and it hasn't been
  updated) for `phone_retention_days` (setting; 0 = keep).
"""
from __future__ import annotations

import base64
import hashlib
import os
import threading
import time
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

PREFIX = "enc:v1:"
MIN_KEY_LEN = 16


def _fernet(secret: str) -> Fernet:
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


_KEY = os.environ.get("PHONE_KEY", "").strip()
_OLD = os.environ.get("PHONE_KEY_OLD", "").strip()
if _KEY and len(_KEY) < MIN_KEY_LEN:
    raise SystemExit(f"PHONE_KEY must be at least {MIN_KEY_LEN} characters (e.g. `openssl rand -base64 32`).")
_MF: Optional[MultiFernet] = MultiFernet([_fernet(k) for k in (_KEY, _OLD) if k]) if _KEY else None


def enabled() -> bool:
    return _MF is not None


def encrypt(phone: str) -> str:
    phone = " ".join((phone or "").split())
    if not phone:
        return ""
    if not _MF:
        raise RuntimeError("PHONE_KEY is not set")
    return PREFIX + _MF.encrypt(phone.encode()).decode()


def decrypt(stored: str) -> Optional[str]:
    """Plain number, '' if none, or None if it can't be read (no / wrong key)."""
    if not stored:
        return ""
    if not stored.startswith(PREFIX):
        return stored  # legacy plaintext (encrypted on the next start with a key)
    if not _MF:
        return None
    try:
        return _MF.decrypt(stored[len(PREFIX):].encode()).decode()
    except InvalidToken:
        return None


def mask(stored: str) -> str:
    """'••••• •••123' style mask (last 3 digits), without needing the full number on screen."""
    plain = decrypt(stored)
    if not stored:
        return ""
    if plain is None:
        return "•••• (locked: PHONE_KEY missing or changed)"
    digits = [c for c in plain if c.isdigit()]
    return "••••• ••" + "".join(digits[-3:]) if len(digits) >= 3 else "•••••"


def phone_mode(settings: dict) -> str:
    """Effective mode for the sign-up form: required | optional | off."""
    if not enabled():
        return "off"
    m = settings.get("phone_mode") or "required"
    return m if m in ("required", "optional", "off") else "required"


def migrate(conn) -> dict:
    """Encrypt legacy plaintext numbers / rotate to the current key; stamp missing dates."""
    conn.execute("UPDATE members SET phone_updated_at = datetime('now') WHERE phone != '' AND phone_updated_at = ''")
    if not _MF:
        n = conn.execute("SELECT COUNT(*) FROM members WHERE phone != '' AND phone NOT LIKE 'enc:v1:%'").fetchone()[0]
        return {"plaintext_left": n, "encrypted": 0}
    done = 0
    for r in conn.execute("SELECT id, phone FROM members WHERE phone != ''").fetchall():
        p = r["phone"]
        if not p.startswith(PREFIX):
            new = encrypt(p)
        elif _OLD:
            try:
                new = PREFIX + _MF.rotate(p[len(PREFIX):].encode()).decode()
            except InvalidToken:
                continue
        else:
            continue
        conn.execute("UPDATE members SET phone = ? WHERE id = ?", (new, r["id"]))
        done += 1
    return {"plaintext_left": 0, "encrypted": done}


def purge_expired(conn, days: int) -> int:
    """Delete numbers whose owner hasn't signed up or updated them for `days` days."""
    if days <= 0:
        return 0
    cur = conn.execute(
        """UPDATE members SET phone = '', phone_updated_at = ''
           WHERE phone != '' AND max(
               phone_updated_at,
               COALESCE((SELECT MAX(updated_at) FROM signups s WHERE s.member_id = members.id), '')
           ) < datetime('now', ?)""", (f"-{int(days)} days",))
    return cur.rowcount


def start_retention_thread(db_module, interval_s: int = 6 * 3600) -> None:
    """Run the deletion now and then every few hours in the background."""
    def loop():
        while True:
            try:
                with db_module.get_conn() as conn:
                    s = db_module.get_settings(conn)
                    n = purge_expired(conn, int(s.get("phone_retention_days") or 0))
                    if n:
                        print(f"[privacy] deleted {n} phone number(s) past the retention period", flush=True)
            except Exception as e:  # noqa: BLE001 - never let the thread die
                print(f"[privacy] retention job failed: {e}", flush=True)
            time.sleep(interval_s)
    threading.Thread(target=loop, name="phone-retention", daemon=True).start()
