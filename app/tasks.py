"""Committee to-do list and handbook (committee only).

The committee's to-do list. Each task has a title, priority, plan
of action, who is doing it, an optional due date, a status, and a timeline of
updates (the old "Completion/update" column, but with history). Repeating tasks
come back when they're marked done: yearly ones (insurance, BR affiliation, safety
audit, ...) with next year's due date, termly ones (subs, ...) due at the same point
of next term (see terms.shift_to_next_term). A task that turns out to be about one boat can be moved
to the boat issue tracker.

The handbook is free text for standing information (contacts, how-tos) that the
committee hands over each year.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db, terms
from .auth import require_committee
from .common import optional_date
from .logic import add_months, real_today
from .issues import SEVERITIES, create_issue

router = APIRouter()

STATUSES = {"open": "To do", "in_progress": "In progress", "waiting": "Waiting", "done": "Done"}
PRIORITIES = {"high": "High", "medium": "Medium", "low": "Low", "": "No priority"}
PRIORITY_RANK = {"high": 3, "medium": 2, "low": 1, "": 0}
REPEATS = {"": "Doesn't repeat", "term": "Every term", "year": "Every year"}


class TaskIn(BaseModel):
    title: str = Field(..., max_length=300)
    priority: str = ""
    plan: str = Field("", max_length=8000)
    owner: str = Field("", max_length=200)
    due: str = ""
    repeat: str = ""


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
    due = optional_date(b.due, "Due date isn't a valid date")
    if b.repeat not in REPEATS:
        raise HTTPException(400, "Unknown repeat")
    if b.repeat and not due:
        raise HTTPException(400, "A repeating task needs a due date")
    return {"title": title, "priority": b.priority, "plan": b.plan.strip(), "owner": " ".join(b.owner.split()),
            "due": due, "repeat": b.repeat}


def _task_or_404(conn, task_id: int):
    t = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not t:
        raise HTTPException(404, "Task not found")
    return t


def _next_year(d: str) -> str:
    return add_months(date.fromisoformat(d), 12).isoformat()


def next_due(t) -> str:
    """When the next copy of a repeating task is due ('' if it doesn't repeat)."""
    if not t["due"]:
        return ""
    if t["repeat"] == "year":
        return _next_year(t["due"])
    if t["repeat"] == "term":
        return terms.shift_to_next_term(t["due"])
    return ""


def _insert(conn, v: dict, author: str = "", note: str = "") -> int:
    cur = conn.execute("INSERT INTO tasks(title, priority, plan, owner, due, repeat) VALUES (?, ?, ?, ?, ?, ?)",
                       (v["title"], v["priority"], v["plan"], v["owner"], v["due"], v["repeat"]))
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
            r["latest"] = latest.get(r["id"])
            r["notes"] = counts.get(r["id"], 0)
        rows.sort(key=lambda r: (r["status"] == "done", -PRIORITY_RANK.get(r["priority"], 0), r["due"] or "9999", r["title"].lower()))
        open_issues = conn.execute("SELECT COUNT(*) FROM boat_issues WHERE status IN ('open', 'in_progress', 'waiting')").fetchone()[0]
        return {"tasks": rows, "statuses": STATUSES, "priorities": PRIORITIES, "repeats": REPEATS, "open_boat_issues": open_issues,
                "owners": sorted({r["owner"] for r in rows if r["owner"]}, key=str.lower)}


@router.get("/api/committee/tasks/{task_id}")
def task_detail(task_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        t = dict(_task_or_404(conn, task_id))
        t["next_due"] = next_due(t)
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
        conn.execute("""UPDATE tasks SET title=?, priority=?, plan=?, owner=?, due=?, repeat=?, updated_at=datetime('now')
                        WHERE id=?""", (v["title"], v["priority"], v["plan"], v["owner"], v["due"], v["repeat"], task_id))
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
        if status == "done" and (due := next_due(t)):
            nxt = {"title": t["title"], "priority": t["priority"], "plan": t["plan"], "owner": t["owner"],
                   "due": due, "repeat": t["repeat"]}
            last = "term" if t["repeat"] == "term" else "year"
            next_id = _insert(conn, nxt, who, f"Repeats every {last}. Last {last}'s was done {real_today().strftime('%d %b %Y')}.")
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
        iid = create_issue(conn, b.boat_id, t["title"], desc, b.severity, who, status, t["created_at"])
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
