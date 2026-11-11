"""Boat club outing planner — FastAPI app."""
from __future__ import annotations

import os
import secrets
import time

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import (auth, autofill, boats, calendar, committee_roster, crewlog, db, handover, incidents, issues, members, outings,
               places, presence, privacy, push, races, river, schedule, settings, signup, socials, stats, subs, tasks, usage)
from .auth import require_committee

STATIC = os.path.join(os.path.dirname(__file__), "static")

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


# ------------------------------------------------------------ activity ----
_STARTED = time.time()


@app.get("/api/committee/activity")
def activity(request: Request, _: str = Depends(require_committee)):
    """Recent use of the site by other browsers (not this one), to time a restart."""
    with db.get_conn() as conn:
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM members")}
    rows = presence.recent(presence.session_id(request))
    for r in rows:
        r["name"] = names.get(r.pop("member_id"), "")
    return {"sessions": rows, "uptime_s": int(time.time() - _STARTED)}


# -------------------------------------------------------------- static ----
@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.exception_handler(HTTPException)
async def http_exc(_, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


for _module in (auth, schedule, subs, outings, members, boats, places, settings, signup, crewlog, calendar, stats, races,
                issues, committee_roster, tasks, autofill, usage, handover, incidents, socials, push):
    app.include_router(_module.router)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(os.path.join(STATIC, "manifest.webmanifest"),
                        media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"})


@app.get("/sw.js")
def service_worker():
    # Served from the root so it controls the whole site (needed for push notifications).
    return FileResponse(os.path.join(STATIC, "sw.js"), media_type="text/javascript",
                        headers={"Cache-Control": "no-cache"})


@app.get("/robots.txt")
def robots():
    # Private club tool: ask all crawlers to stay out.
    return FileResponse(os.path.join(STATIC, "robots.txt"), media_type="text/plain")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})
