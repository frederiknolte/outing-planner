"""Who has used the site recently: for timing a server restart (Settings → Recent activity).

Every signed-in API request records, per browser session, when it happened and what it
was. The app doesn't poll in the background, so a request means someone actually did
something (opened a page, saved a change). Kept in memory only: it starts empty after
every restart, and entries older than a week are dropped.
"""
from __future__ import annotations

import secrets
import threading
import time

from fastapi import Request

KEEP_S = 7 * 24 * 3600
_lock = threading.Lock()
_seen: dict[str, dict] = {}


def _device(ua: str) -> str:
    ua = ua or ""
    os_ = next((n for k, n in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"), ("Mac OS X", "Mac"),
                               ("Windows", "Windows"), ("Linux", "Linux")) if k in ua), "")
    br = next((n for k, n in (("Edg/", "Edge"), ("Firefox/", "Firefox"), ("CriOS", "Chrome"), ("Chrome/", "Chrome"),
                              ("Safari/", "Safari")) if k in ua), "")
    return " · ".join(x for x in (os_, br) if x)


def session_id(request: Request) -> str:
    sid = request.session.get("sid")
    if not sid:
        sid = request.session["sid"] = secrets.token_urlsafe(12)
    return sid


def record(request: Request, role: str) -> None:
    if not request.url.path.startswith("/api/"):
        return
    sid = session_id(request)
    now = time.time()
    acting = request.headers.get("X-Acting-As", "")
    write = request.method not in ("GET", "HEAD", "OPTIONS")
    with _lock:
        e = _seen.setdefault(sid, {"first": now})
        e.update(last=now, role=role, path=request.url.path)
        dev = _device(request.headers.get("User-Agent", ""))
        if dev:
            e["device"] = dev
        if acting.isdigit():
            e["member_id"] = int(acting)
        if write:
            e["last_write"] = now
            e["write_path"] = f"{request.method} {request.url.path}"
        if len(_seen) > 2000 or now - e["first"] > 60:  # prune now and then
            for k in [k for k, v in _seen.items() if now - v["last"] > KEEP_S]:
                del _seen[k]


def recent(exclude_sid: str) -> list[dict]:
    now = time.time()
    with _lock:
        rows = [dict(v, sid=k) for k, v in _seen.items() if k != exclude_sid and now - v["last"] <= KEEP_S]
    rows.sort(key=lambda r: -r["last"])
    return [{"ago_s": int(now - r["last"]), "role": r["role"], "member_id": r.get("member_id"),
             "path": r["path"], "device": r.get("device", ""),
             "write_ago_s": int(now - r["last_write"]) if r.get("last_write") else None,
             "write_path": r.get("write_path", "")} for r in rows]
