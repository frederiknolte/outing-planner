"""Session-based role checks shared by all routers."""
from typing import Optional

from fastapi import HTTPException, Request


def role_of(request: Request) -> Optional[str]:
    return request.session.get("role")


def require_member(request: Request) -> str:
    role = role_of(request)
    if role not in ("member", "committee"):
        raise HTTPException(401, "Not signed in")
    return role


def require_committee(request: Request) -> str:
    if role_of(request) != "committee":
        raise HTTPException(403, "Committee access required")
    return "committee"
