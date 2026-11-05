"""Session-based role checks shared by all routers."""
from typing import Optional

from fastapi import HTTPException, Request

from . import presence


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
