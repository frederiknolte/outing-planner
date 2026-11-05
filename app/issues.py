"""Boat issue tracker with photos.

Anyone signed in can report a problem with a boat, add notes and attach photos.
The committee changes the status (open → in repair → waiting on parts → fixed / closed),
edit or delete issues, and remove photos.

Photos are compressed in the browser (resized to ~1600 px and re-encoded as JPEG,
which also strips EXIF data such as GPS position) before upload, so the server
never decodes an image and needs almost no memory for them. The server streams the
upload straight to disk, stops at MAX_PHOTO_BYTES, checks the file signature, and
enforces a total storage limit (setting "photo_storage_mb").
"""
from __future__ import annotations

import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db
from .auth import require_committee, require_member

router = APIRouter()

PHOTO_DIR = os.path.join(db.DATA_DIR, "photos")
MAX_PHOTO_BYTES = 2 * 1024 * 1024     # browser output is usually 200–500 KB
MAX_PHOTOS_PER_ISSUE = 12
DEFAULT_STORAGE_MB = 300

STATUSES = {"open": "Open", "in_progress": "In repair", "waiting": "Waiting on parts",
            "fixed": "Fixed", "closed": "Closed"}
ACTIVE = ("open", "in_progress", "waiting")
SEVERITIES = {"minor": "Minor", "caution": "Use with care", "unusable": "Do not use"}
SEVERITY_RANK = {"minor": 1, "caution": 2, "unusable": 3}
SIGNATURES = (  # (magic bytes test, extension, media type)
    (lambda h: h[:3] == b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (lambda h: h[:8] == b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (lambda h: h[:4] == b"RIFF" and h[8:12] == b"WEBP", "webp", "image/webp"),
)
MEDIA = {ext: mt for _, ext, mt in SIGNATURES}


# ------------------------------------------------------------- helpers ----
def _photo_path(filename: str) -> str:
    return os.path.join(PHOTO_DIR, os.path.basename(filename))


def _remove_files(names) -> None:
    for n in names:
        try:
            os.remove(_photo_path(n))
        except FileNotFoundError:
            pass


def delete_boat_photos(conn, boat_id: int) -> None:
    """Remove photo files for a boat about to be deleted (rows go by cascade)."""
    names = [r[0] for r in conn.execute(
        "SELECT p.filename FROM issue_photos p JOIN boat_issues i ON i.id = p.issue_id WHERE i.boat_id = ?", (boat_id,))]
    _remove_files(names)


def sweep_orphans() -> int:
    """At start-up: delete photo files with no database row (e.g. after a crash mid-upload)."""
    os.makedirs(PHOTO_DIR, exist_ok=True)
    with db.get_conn() as conn:
        known = {r[0] for r in conn.execute("SELECT filename FROM issue_photos")}
    removed = 0
    for n in os.listdir(PHOTO_DIR):
        if n not in known:
            try:
                os.remove(_photo_path(n))
                removed += 1
            except OSError:
                pass
    return removed


def _storage(conn) -> dict:
    used = conn.execute("SELECT COALESCE(SUM(size), 0) FROM issue_photos").fetchone()[0]
    try:
        limit_mb = int(db.get_settings(conn).get("photo_storage_mb") or DEFAULT_STORAGE_MB)
    except ValueError:
        limit_mb = DEFAULT_STORAGE_MB
    return {"used": used, "limit": limit_mb * 1024 * 1024, "limit_mb": limit_mb,
            "count": conn.execute("SELECT COUNT(*) FROM issue_photos").fetchone()[0]}


def _issue_or_404(conn, issue_id: int):
    row = conn.execute("SELECT * FROM boat_issues WHERE id = ?", (issue_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Issue not found")
    return row


def _name(s: str) -> str:
    s = " ".join(s.split())
    if not s:
        raise HTTPException(400, "Add your name")
    return s


# -------------------------------------------------------------- models ----
class IssueIn(BaseModel):
    boat_id: int
    title: str = Field(..., max_length=150)
    description: str = Field("", max_length=4000)
    severity: str = "minor"
    reported_by: str = Field("", max_length=80)


class IssueEdit(BaseModel):
    boat_id: int
    title: str = Field(..., max_length=150)
    description: str = Field("", max_length=4000)
    severity: str = "minor"


class UpdateIn(BaseModel):
    note: str = Field("", max_length=4000)
    status: str = ""          # committee only; blank = no change
    author: str = Field("", max_length=80)


class StorageIn(BaseModel):
    photo_storage_mb: int = Field(DEFAULT_STORAGE_MB, ge=10, le=100000)


# -------------------------------------------------------------- routes ----
@router.get("/api/issues")
def issues_list(_: str = Depends(require_member)):
    with db.get_conn() as conn:
        rows = conn.execute(
            """SELECT i.*, b.name AS boat_name,
                      (SELECT COUNT(*) FROM issue_photos p WHERE p.issue_id = i.id) AS photos,
                      (SELECT COUNT(*) FROM issue_updates u WHERE u.issue_id = i.id AND u.note != '') AS notes
               FROM boat_issues i JOIN boats b ON b.id = i.boat_id
               ORDER BY i.status IN ('fixed', 'closed'), i.updated_at DESC""").fetchall()
        return {"issues": [dict(r) for r in rows], "statuses": STATUSES, "active": list(ACTIVE),
                "severities": SEVERITIES}


@router.get("/api/issues/{issue_id}")
def issue_detail(issue_id: int, _: str = Depends(require_member)):
    with db.get_conn() as conn:
        i = dict(_issue_or_404(conn, issue_id))
        i["boat_name"] = conn.execute("SELECT name FROM boats WHERE id = ?", (i["boat_id"],)).fetchone()[0]
        i["updates"] = [dict(r) for r in conn.execute(
            "SELECT * FROM issue_updates WHERE issue_id = ? ORDER BY created_at, id", (issue_id,))]
        from .incidents import linked_to_issue   # incidents imports this module
        i["incidents"] = linked_to_issue(conn, issue_id)
        i["photos"] = [{"id": r["id"], "uploaded_by": r["uploaded_by"], "created_at": r["created_at"], "size": r["size"]}
                       for r in conn.execute("SELECT * FROM issue_photos WHERE issue_id = ? ORDER BY id", (issue_id,))]
        return i


@router.post("/api/issues")
def issue_create(b: IssueIn, _: str = Depends(require_member)):
    if b.severity not in SEVERITIES:
        raise HTTPException(400, "Pick how serious it is")
    title = b.title.strip()
    if not title:
        raise HTTPException(400, "Give the issue a short title")
    who = _name(b.reported_by)
    with db.get_conn() as conn:
        if not conn.execute("SELECT 1 FROM boats WHERE id = ?", (b.boat_id,)).fetchone():
            raise HTTPException(400, "Pick a boat")
        return {"id": create_issue(conn, b.boat_id, title, b.description.strip(), b.severity, who)}


def create_issue(conn, boat_id: int, title: str, description: str, severity: str, who: str,
                 status: str = "open", created_at=None) -> int:
    """Add a boat issue with its first ("open") history entry. Used by boat issues, incidents and to-dos."""
    created = created_at or conn.execute("SELECT datetime('now')").fetchone()[0]
    iid = conn.execute("""INSERT INTO boat_issues(boat_id, title, description, severity, status, reported_by, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?)""",
                       (boat_id, title[:150], description[:4000], severity, status, who, created)).lastrowid
    conn.execute("INSERT INTO issue_updates(issue_id, status, note, author, created_at) VALUES (?, 'open', '', ?, ?)",
                 (iid, who, created))
    return iid


@router.put("/api/issues/{issue_id}")
def issue_edit(issue_id: int, b: IssueEdit, _: str = Depends(require_committee)):
    if b.severity not in SEVERITIES:
        raise HTTPException(400, "Unknown severity")
    if not b.title.strip():
        raise HTTPException(400, "Give the issue a short title")
    with db.get_conn() as conn:
        _issue_or_404(conn, issue_id)
        if not conn.execute("SELECT 1 FROM boats WHERE id = ?", (b.boat_id,)).fetchone():
            raise HTTPException(400, "Pick a boat")
        conn.execute("""UPDATE boat_issues SET boat_id=?, title=?, description=?, severity=?, updated_at=datetime('now')
                        WHERE id=?""", (b.boat_id, b.title.strip(), b.description.strip(), b.severity, issue_id))
        return {"ok": True}


@router.post("/api/issues/{issue_id}/updates")
def issue_update(issue_id: int, b: UpdateIn, role: str = Depends(require_member)):
    note = b.note.strip()
    status = b.status or ""
    if status and status not in STATUSES:
        raise HTTPException(400, "Unknown status")
    if status and role != "committee":
        raise HTTPException(403, "Only the committee can change the status")
    with db.get_conn() as conn:
        i = _issue_or_404(conn, issue_id)
        if status == i["status"]:
            status = ""
        if not note and not status:
            raise HTTPException(400, "Write a note or change the status")
        who = _name(b.author)
        conn.execute("INSERT INTO issue_updates(issue_id, status, note, author) VALUES (?, ?, ?, ?)",
                     (issue_id, status, note, who))
        if status:
            conn.execute("""UPDATE boat_issues SET status=?, updated_at=datetime('now'),
                              resolved_at = CASE WHEN ? IN ('fixed', 'closed') THEN datetime('now') ELSE NULL END
                            WHERE id=?""", (status, status, issue_id))
        else:
            conn.execute("UPDATE boat_issues SET updated_at=datetime('now') WHERE id=?", (issue_id,))
        return {"ok": True}


@router.delete("/api/issues/{issue_id}")
def issue_delete(issue_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        names = [r[0] for r in conn.execute("SELECT filename FROM issue_photos WHERE issue_id = ?", (issue_id,))]
        conn.execute("DELETE FROM boat_issues WHERE id = ?", (issue_id,))
    _remove_files(names)
    return {"ok": True}


@router.post("/api/issues/{issue_id}/photos")
async def photo_upload(issue_id: int, request: Request, by: str = "", _: str = Depends(require_member)):
    """Body is the raw (already compressed) image. Streamed to disk; never held in memory or decoded."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Photo is too large")
    with db.get_conn() as conn:
        _issue_or_404(conn, issue_id)
        if conn.execute("SELECT COUNT(*) FROM issue_photos WHERE issue_id = ?", (issue_id,)).fetchone()[0] >= MAX_PHOTOS_PER_ISSUE:
            raise HTTPException(400, f"At most {MAX_PHOTOS_PER_ISSUE} photos per issue")
        st = _storage(conn)
    if st["used"] >= st["limit"]:
        raise HTTPException(507, "Photo storage is full. The committee can delete old photos or raise the limit in Settings")

    os.makedirs(PHOTO_DIR, exist_ok=True)
    tmp = _photo_path(f".upload-{secrets.token_hex(8)}")
    size, head = 0, b""
    try:
        with open(tmp, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_PHOTO_BYTES:
                    raise HTTPException(413, "Photo is too large")
                if len(head) < 12:
                    head += chunk[:12 - len(head)]
                f.write(chunk)
        kind = next(((ext, mt) for test, ext, mt in SIGNATURES if test(head)), None)
        if not size or not kind:
            raise HTTPException(400, "That file isn't a JPEG, PNG or WebP image")
        name = f"{secrets.token_hex(16)}.{kind[0]}"
        with db.get_conn() as conn:
            st = _storage(conn)
            if st["used"] + size > st["limit"]:
                raise HTTPException(507, "Photo storage is full. The committee can delete old photos or raise the limit in Settings")
            os.replace(tmp, _photo_path(name))
            try:
                cur = conn.execute("INSERT INTO issue_photos(issue_id, filename, size, uploaded_by) VALUES (?, ?, ?, ?)",
                                   (issue_id, name, size, " ".join(by.split())[:80]))
                conn.execute("UPDATE boat_issues SET updated_at=datetime('now') WHERE id=?", (issue_id,))
            except Exception:
                _remove_files([name])
                raise
        return {"id": cur.lastrowid, "size": size}
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


@router.get("/api/issues/photos/{photo_id}")
def photo_get(photo_id: int, _: str = Depends(require_member)):
    with db.get_conn() as conn:
        r = conn.execute("SELECT filename FROM issue_photos WHERE id = ?", (photo_id,)).fetchone()
    if not r or not os.path.exists(_photo_path(r["filename"])):
        raise HTTPException(404, "Photo not found")
    ext = r["filename"].rsplit(".", 1)[-1]
    return FileResponse(_photo_path(r["filename"]), media_type=MEDIA.get(ext, "application/octet-stream"),
                        headers={"Cache-Control": "private, max-age=31536000, immutable",
                                 "X-Content-Type-Options": "nosniff"})


@router.delete("/api/issues/photos/{photo_id}")
def photo_delete(photo_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        r = conn.execute("SELECT filename FROM issue_photos WHERE id = ?", (photo_id,)).fetchone()
        if not r:
            raise HTTPException(404, "Photo not found")
        conn.execute("DELETE FROM issue_photos WHERE id = ?", (photo_id,))
    _remove_files([r["filename"]])
    return {"ok": True}


@router.get("/api/committee/photo-storage")
def storage_get(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        return _storage(conn)


@router.put("/api/committee/photo-storage")
def storage_set(b: StorageIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        db.set_setting(conn, "photo_storage_mb", str(b.photo_storage_mb))
        return _storage(conn)
