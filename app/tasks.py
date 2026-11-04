"""Committee to-do list and handbook (committee only).

Replaces the committee's Word to-do table. Each task has a title, priority, plan
of action, who is doing it, an optional due date, a status, and a timeline of
updates (the old "Completion/update" column, but with history). Yearly tasks
(insurance, BR affiliation, safety audit, ...) come back with next year's due date
when they're marked done. A task that turns out to be about one boat can be moved
to the boat issue tracker.

The handbook is free text for standing information (contacts, how-tos) that the
committee hands over each year.

The Word import reads the first table whose header row looks like a to-do list,
plus the paragraphs after it (for the handbook), using only the standard library.
"""
from __future__ import annotations

import io
import re
import zipfile
from datetime import date
from typing import Optional
from xml.etree import ElementTree as ET

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import db
from .auth import require_committee
from .issues import SEVERITIES

router = APIRouter()

STATUSES = {"open": "To do", "in_progress": "In progress", "waiting": "Waiting", "done": "Done"}
PRIORITIES = {"high": "High", "medium": "Medium", "low": "Low", "": "No priority"}
PRIORITY_RANK = {"high": 3, "medium": 2, "low": 1, "": 0}
MAX_DOCX = 5 * 1024 * 1024
MAX_XML = 20 * 1024 * 1024


class TaskIn(BaseModel):
    title: str = Field(..., max_length=300)
    priority: str = ""
    plan: str = Field("", max_length=8000)
    owner: str = Field("", max_length=200)
    due: str = ""
    repeat_yearly: bool = False


class UpdateIn(BaseModel):
    note: str = Field("", max_length=4000)
    status: str = ""
    author: str = Field("", max_length=80)


class MoveIn(BaseModel):
    boat_id: int
    severity: str = "minor"
    author: str = Field("", max_length=80)


class HandbookIn(BaseModel):
    text: str = Field("", max_length=50000)


def _validate(b: TaskIn) -> dict:
    title = " ".join(b.title.split())
    if not title:
        raise HTTPException(400, "Give the task a title")
    if b.priority not in PRIORITIES:
        raise HTTPException(400, "Unknown priority")
    due = ""
    if b.due:
        try:
            due = date.fromisoformat(b.due).isoformat()
        except ValueError:
            raise HTTPException(400, "Due date isn't a valid date")
    if b.repeat_yearly and not due:
        raise HTTPException(400, "A yearly task needs a due date")
    return {"title": title, "priority": b.priority, "plan": b.plan.strip(), "owner": " ".join(b.owner.split()),
            "due": due, "repeat_yearly": int(b.repeat_yearly)}


def _task_or_404(conn, task_id: int):
    t = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not t:
        raise HTTPException(404, "Task not found")
    return t


def _next_year(d: str) -> str:
    x = date.fromisoformat(d)
    try:
        return x.replace(year=x.year + 1).isoformat()
    except ValueError:            # 29 February
        return x.replace(year=x.year + 1, day=28).isoformat()


def _insert(conn, v: dict, author: str = "", note: str = "") -> int:
    cur = conn.execute("INSERT INTO tasks(title, priority, plan, owner, due, repeat_yearly) VALUES (?, ?, ?, ?, ?, ?)",
                       (v["title"], v["priority"], v["plan"], v["owner"], v["due"], v["repeat_yearly"]))
    conn.execute("INSERT INTO task_updates(task_id, status, note, author) VALUES (?, 'open', ?, ?)",
                 (cur.lastrowid, note, author))
    return cur.lastrowid


# -------------------------------------------------------------- routes ----
@router.get("/api/committee/tasks")
def tasks_list(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM tasks")]
        latest = {}
        for u in conn.execute("SELECT task_id, note, author, created_at FROM task_updates WHERE note != '' ORDER BY created_at, id"):
            latest[u["task_id"]] = dict(u)
        counts = {r[0]: r[1] for r in conn.execute("SELECT task_id, COUNT(*) FROM task_updates WHERE note != '' GROUP BY task_id")}
        for r in rows:
            r["repeat_yearly"] = bool(r["repeat_yearly"])
            r["latest"] = latest.get(r["id"])
            r["notes"] = counts.get(r["id"], 0)
        rows.sort(key=lambda r: (r["status"] == "done", -PRIORITY_RANK.get(r["priority"], 0), r["due"] or "9999", r["title"].lower()))
        open_issues = conn.execute("SELECT COUNT(*) FROM boat_issues WHERE status IN ('open', 'in_progress', 'waiting')").fetchone()[0]
        return {"tasks": rows, "statuses": STATUSES, "priorities": PRIORITIES, "open_boat_issues": open_issues,
                "owners": sorted({r["owner"] for r in rows if r["owner"]}, key=str.lower)}


@router.get("/api/committee/tasks/{task_id}")
def task_detail(task_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        t = dict(_task_or_404(conn, task_id))
        t["repeat_yearly"] = bool(t["repeat_yearly"])
        t["updates"] = [dict(r) for r in conn.execute("SELECT * FROM task_updates WHERE task_id = ? ORDER BY created_at, id", (task_id,))]
        return t


@router.post("/api/committee/tasks")
def task_create(b: TaskIn, author: str = "", _: str = Depends(require_committee)):
    v = _validate(b)
    with db.get_conn() as conn:
        return {"id": _insert(conn, v, " ".join(author.split())[:80])}


@router.put("/api/committee/tasks/{task_id}")
def task_edit(task_id: int, b: TaskIn, _: str = Depends(require_committee)):
    v = _validate(b)
    with db.get_conn() as conn:
        _task_or_404(conn, task_id)
        conn.execute("""UPDATE tasks SET title=?, priority=?, plan=?, owner=?, due=?, repeat_yearly=?, updated_at=datetime('now')
                        WHERE id=?""", (v["title"], v["priority"], v["plan"], v["owner"], v["due"], v["repeat_yearly"], task_id))
        return {"ok": True}


@router.post("/api/committee/tasks/{task_id}/updates")
def task_update(task_id: int, b: UpdateIn, _: str = Depends(require_committee)):
    status = b.status or ""
    if status and status not in STATUSES:
        raise HTTPException(400, "Unknown status")
    note = b.note.strip()
    with db.get_conn() as conn:
        t = _task_or_404(conn, task_id)
        if status == t["status"]:
            status = ""
        if not note and not status:
            raise HTTPException(400, "Write an update or change the status")
        who = " ".join(b.author.split())
        conn.execute("INSERT INTO task_updates(task_id, status, note, author) VALUES (?, ?, ?, ?)", (task_id, status, note, who))
        conn.execute("""UPDATE tasks SET status = COALESCE(NULLIF(?, ''), status), updated_at = datetime('now'),
                          done_at = CASE WHEN ? = 'done' THEN datetime('now') WHEN ? != '' THEN NULL ELSE done_at END
                        WHERE id = ?""", (status, status, status, task_id))
        next_id = None
        if status == "done" and t["repeat_yearly"] and t["due"]:
            nxt = {"title": t["title"], "priority": t["priority"], "plan": t["plan"], "owner": t["owner"],
                   "due": _next_year(t["due"]), "repeat_yearly": 1}
            next_id = _insert(conn, nxt, who, f"Repeats every year. Last year's was done {date.today().strftime('%d %b %Y')}.")
        return {"ok": True, "next_id": next_id}


@router.delete("/api/committee/tasks/{task_id}")
def task_delete(task_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return {"ok": True}


@router.post("/api/committee/tasks/{task_id}/move-to-boat")
def task_to_boat_issue(task_id: int, b: MoveIn, _: str = Depends(require_committee)):
    """Turn a task about one boat into a boat issue, carrying over the plan, owner and update history."""
    if b.severity not in SEVERITIES:
        raise HTTPException(400, "Pick how serious it is")
    with db.get_conn() as conn:
        t = _task_or_404(conn, task_id)
        if not conn.execute("SELECT 1 FROM boats WHERE id = ?", (b.boat_id,)).fetchone():
            raise HTTPException(400, "Pick a boat")
        desc = "\n\n".join(x for x in [t["plan"], f"Who: {t['owner']}" if t["owner"] else ""] if x)
        status = {"open": "open", "in_progress": "in_progress", "waiting": "waiting", "done": "fixed"}[t["status"]]
        who = " ".join(b.author.split()) or "Committee"
        cur = conn.execute("""INSERT INTO boat_issues(boat_id, title, description, severity, status, reported_by, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?)""",
                           (b.boat_id, t["title"][:150], desc[:4000], b.severity, status, who, t["created_at"]))
        iid = cur.lastrowid
        conn.execute("INSERT INTO issue_updates(issue_id, status, note, author, created_at) VALUES (?, 'open', '', ?, ?)",
                     (iid, who, t["created_at"]))
        for u in conn.execute("SELECT * FROM task_updates WHERE task_id = ? AND note != '' ORDER BY created_at, id", (task_id,)):
            conn.execute("INSERT INTO issue_updates(issue_id, status, note, author, created_at) VALUES (?, '', ?, ?, ?)",
                         (iid, u["note"], u["author"], u["created_at"]))
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return {"issue_id": iid}


@router.get("/api/committee/handbook")
def handbook_get(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        return {"text": db.get_settings(conn).get("committee_handbook", "")}


@router.put("/api/committee/handbook")
def handbook_set(b: HandbookIn, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        db.set_setting(conn, "committee_handbook", b.text.strip())
        return {"ok": True}


# --------------------------------------------------------- Word import ----
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
COLUMNS = {  # field -> header keywords
    "title": ("issue", "task", "item", "what"),
    "priority": ("priority",),
    "plan": ("plan", "action", "description", "detail"),
    "owner": ("person", "who", "owner", "responsible", "lead"),
    "update": ("update", "completion", "progress", "status"),
}


def _para_text(p) -> str:
    out = []
    for el in p.iter():
        if el.tag == W + "t":
            out.append(el.text or "")
        elif el.tag in (W + "tab",):
            out.append(" ")
        elif el.tag in (W + "br", W + "cr"):
            out.append("\n")
    return " ".join("".join(out).split(" ")).strip()


def _cell_text(tc) -> str:
    return "\n".join(t for t in (_para_text(p) for p in tc.iter(W + "p")) if t)


def _priority(text: str) -> tuple[str, str]:
    """('high'|'medium'|'low'|'', note): the highest level mentioned, plus the original text if it says more."""
    t = text.lower()
    found = [k for k in ("high", "medium", "low") if re.search(rf"\b{k}", t)]
    level = max(found, key=PRIORITY_RANK.get) if found else ""
    extra = text.strip() if text.strip() and text.strip().lower() != level else ""
    return level, ("" if re.fullmatch(r"[?\s]*", extra) else extra)


def parse_docx(data: bytes) -> dict:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        info = z.getinfo("word/document.xml")
    except (zipfile.BadZipFile, KeyError):
        raise HTTPException(400, "That isn't a Word (.docx) document")
    if info.file_size > MAX_XML:
        raise HTTPException(400, "The document is too large")
    try:
        root = ET.fromstring(z.read(info))
    except ET.ParseError:
        raise HTTPException(400, "Could not read the document")
    body = root.find(W + "body")
    rows, notes, cols, in_table_done = [], [], None, False
    for el in body:
        if el.tag == W + "tbl" and cols is None:
            trs = el.findall(W + "tr")
            if not trs:
                continue
            header = [_cell_text(tc).lower() for tc in trs[0].findall(W + "tc")]
            found = {}
            for field, keys in COLUMNS.items():
                for i, h in enumerate(header):
                    if i not in found.values() and any(k in h for k in keys):
                        found[field] = i
                        break
            if "title" not in found:
                continue
            cols = found
            for tr in trs[1:]:
                cells = [_cell_text(tc) for tc in tr.findall(W + "tc")]
                get = lambda f: cells[cols[f]] if f in cols and cols[f] < len(cells) else ""  # noqa: E731
                title = " ".join(get("title").split())
                if title:
                    rows.append({k: get(k) for k in COLUMNS} | {"title": title})
            in_table_done = True
        elif el.tag == W + "p" and in_table_done:
            t = _para_text(el)
            if t:
                is_list = el.find(f"{W}pPr/{W}numPr") is not None
                notes.append(("• " if is_list else "") + t)
    if cols is None:
        raise HTTPException(400, "No to-do table found. The first row needs a heading such as “Issue” or “Task”")
    return {"rows": rows, "notes": "\n".join(notes)}


@router.post("/api/committee/tasks/import")
async def tasks_import(file: UploadFile = File(...), notes_to_handbook: bool = Form(True), _: str = Depends(require_committee)):
    data = await file.read(MAX_DOCX + 1)
    if len(data) > MAX_DOCX:
        raise HTTPException(400, "File too large")
    parsed = parse_docx(data)
    who = "Word to-do list"     # the updates were written in the document, not by whoever imports it
    added = skipped = 0
    with db.get_conn() as conn:
        # skip tasks already on the list, and ones that were moved to the boat issue tracker
        have = {r[0].lower() for r in conn.execute("SELECT title FROM tasks UNION SELECT title FROM boat_issues")}
        for r in parsed["rows"]:
            title = r["title"][:300]
            if title.lower() in have:
                skipped += 1
                continue
            level, pnote = _priority(r["priority"])
            plan = "\n".join(x for x in [r["plan"], f"Priority: {pnote}" if pnote else ""] if x)
            v = {"title": title, "priority": level, "plan": plan[:8000], "owner": " ".join(r["owner"].split())[:200],
                 "due": "", "repeat_yearly": 0}
            _insert(conn, v, who, r["update"][:4000])
            have.add(title.lower())
            added += 1
        notes_added = False
        if notes_to_handbook and parsed["notes"]:
            cur = db.get_settings(conn).get("committee_handbook", "")
            if parsed["notes"] not in cur:
                db.set_setting(conn, "committee_handbook", (cur + "\n\n" if cur else "") + parsed["notes"])
                notes_added = True
        return {"added": added, "skipped": skipped, "notes_added": notes_added}
