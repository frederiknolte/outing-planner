"""Session-based role checks shared by all routers."""
from typing import Optional

from fastapi import HTTPException, Request


def role_of(request: Request) -> Optional[str]:
    return request.session.get("role")


def require_member(request: Request) -> str:
    role = role_of(request)
    if role not in ("member", "admin"):
        raise HTTPException(401, "Not signed in")
    return role


def require_admin(request: Request) -> str:
    if role_of(request) != "admin":
        raise HTTPException(403, "Admin access required")
    return "admin"
