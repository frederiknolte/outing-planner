"""Who is on the club committee.

Everyone signed in can see the positions and who holds them; only the committee
can change them. A position is held by a club member (who then gets a golden "C"
next to their name in the rowers list) or by a typed-in name, e.g. a Senior Member
who is a college fellow rather than a rower.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import require_committee, require_member

router = APIRouter()

# (key, label, how many people can hold it)
POSITIONS = [
    ("president", "President", 1),
    ("vice_president", "Vice-President", 1),
    ("mens_captain", "Men's Captain", 2),
    ("womens_captain", "Women's Captain", 2),
    ("treasurer", "Treasurer", 1),
    ("captain_of_coxes", "Captain of Coxes", 1),
    ("senior_member", "Senior Member", 4),
    ("welfare", "Welfare Officer", 1),
    ("kit", "Kit Officer", 1),
    ("social_sec", "Social Sec", 1),
    ("secretary", "Secretary", 1),
]
SLOTS = {k: n for k, _, n in POSITIONS}


class HolderIn(BaseModel):
    position: str
    slot: int = Field(0, ge=0)
    member_id: Optional[int] = None
    name: str = Field("", max_length=100)


class RosterIn(BaseModel):
    holders: list[HolderIn] = []


def roster(conn) -> list[dict]:
    rows = conn.execute(
        """SELECT h.position, h.slot, h.member_id, COALESCE(m.name, h.name) AS name
           FROM committee_holders h LEFT JOIN members m ON m.id = h.member_id""").fetchall()
    order = {k: i for i, (k, _, _) in enumerate(POSITIONS)}
    return sorted((dict(r) for r in rows if r["position"] in SLOTS), key=lambda r: (order[r["position"]], r["slot"]))


@router.get("/api/club-committee")
def roster_get(_: str = Depends(require_member)):
    with db.get_conn() as conn:
        return {"positions": [{"key": k, "label": l, "max": n} for k, l, n in POSITIONS], "holders": roster(conn)}


def clean_holders(holders: list[HolderIn]) -> list[tuple]:
    """Validate a full roster; returns (position, slot, member_id, name) rows, vacancies dropped."""
    seen = set()
    clean = []
    for h in holders:
        if h.position not in SLOTS:
            raise HTTPException(400, f"Unknown position: {h.position}")
        if h.slot >= SLOTS[h.position]:
            raise HTTPException(400, "Too many people for one position")
        if (h.position, h.slot) in seen:
            raise HTTPException(400, "Duplicate position")
        seen.add((h.position, h.slot))
        name = " ".join(h.name.split())
        if h.member_id is None and not name:
            continue                                   # left empty = vacant
        clean.append((h.position, h.slot, h.member_id, "" if h.member_id else name))
    return clean


def save_holders(conn, clean: list[tuple]) -> None:
    """Replace the whole roster (rows from clean_holders)."""
    ids = {mid for _, _, mid, _ in clean if mid is not None}
    if ids:
        found = {r[0] for r in conn.execute(f"SELECT id FROM members WHERE id IN ({','.join('?' * len(ids))})", tuple(ids))}
        if ids - found:
            raise HTTPException(400, "Member not found")
    conn.execute("DELETE FROM committee_holders")
    conn.executemany("INSERT INTO committee_holders(position, slot, member_id, name) VALUES (?, ?, ?, ?)", clean)


@router.put("/api/committee/club-committee")
def roster_set(b: RosterIn, _: str = Depends(require_committee)):
    clean = clean_holders(b.holders)
    with db.get_conn() as conn:
        save_holders(conn, clean)
        return {"holders": roster(conn)}
