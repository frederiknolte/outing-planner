"""Sign-in: the two club passwords, the login endpoints and the session role checks shared by all routers."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from . import db, presence

COMMITTEE_PASSWORD = os.environ.get("COMMITTEE_PASSWORD", "")
MEMBER_PASSWORD = os.environ.get("MEMBER_PASSWORD", "")
if not COMMITTEE_PASSWORD or not MEMBER_PASSWORD:
    raise SystemExit("COMMITTEE_PASSWORD and MEMBER_PASSWORD environment variables must both be set.")
if COMMITTEE_PASSWORD == MEMBER_PASSWORD:
    raise SystemExit("COMMITTEE_PASSWORD and MEMBER_PASSWORD must be different.")

router = APIRouter()


# ------------------------------------------------------------- roles ----
def role_of(request: Request) -> Optional[str]:
    return request.session.get("role")


def require_member(request: Request) -> str:
    role = role_of(request)
    if role not in ("member", "committee"):
        raise HTTPException(401, "Not signed in")
    presence.record(request, role)
    # A committee member can preview the site as a rower; the client sends this header while
    # that view is on, so pages get exactly what a rower would (no drafts, no eligibility).
    if role == "committee" and request.headers.get("X-View-As") == "member":
        return "member"
    return role


def require_committee(request: Request) -> str:
    if role_of(request) != "committee":
        raise HTTPException(403, "Committee access required")
    presence.record(request, "committee")
    return "committee"


# --------------------------------------------------------- passwords ----
def hash_pw(pw: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return salt.hex() + "$" + h.hex()


def _check_hash(pw: str, stored: str) -> bool:
    try:
        salt_hex, h_hex = stored.split("$")
        return hmac.compare_digest(hash_pw(pw, bytes.fromhex(salt_hex)).split("$")[1], h_hex)
    except ValueError:
        return False


def is_committee_password(pw: str) -> bool:
    return hmac.compare_digest(pw.encode(), COMMITTEE_PASSWORD.encode())


_attempts: dict[str, list[float]] = defaultdict(list)


def _rate_limited(ip: str) -> bool:
    now = time.time()
    recent = [t for t in _attempts.get(ip, ()) if now - t < 300]
    if recent:
        _attempts[ip] = recent
    else:
        _attempts.pop(ip, None)   # don't keep an entry for every address ever seen
    return len(recent) >= 10


# --------------------------------------------------------- endpoints ----
class LoginIn(BaseModel):
    password: str


@router.post("/api/login")
def login(body: LoginIn, request: Request):
    ip = request.client.host if request.client else "?"
    if _rate_limited(ip):
        raise HTTPException(429, "Too many attempts — try again in a few minutes")
    pw = body.password
    role = None
    if is_committee_password(pw):
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


@router.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/api/me")
def me(request: Request):
    return {"role": role_of(request)}
