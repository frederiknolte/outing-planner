"""Club settings (committee only): term and year, subs rules, qualification validity, phone numbers, the rower
password, and a database backup."""
from __future__ import annotations

import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db, privacy
from .auth import hash_pw, is_committee_password, require_committee
from .common import optional_date
from .logic import TERMS, int_setting

router = APIRouter()

# Whole-number settings: sent to the page as numbers, and saved only when given (None = keep).
NUMBER_SETTINGS = ("novice_free_outings", "swim_test_after", "swim_test_valid_months", "cox_status_valid_months",
                   "capsize_drill_valid_months", "phone_retention_days")


class SettingsIn(BaseModel):
    club_name: str = Field("Reuben Boat Club", max_length=80)
    academic_year: str = Field(..., max_length=20)
    current_term: str
    subs_cutoff: str = ""
    today_override: str = ""
    novice_free_outings: int = Field(4, ge=0, le=50)
    novice_land_free: bool = True
    season_start: str = ""
    member_password: str = Field("", max_length=200)
    phone_mode: str = "required"
    phone_retention_days: int = Field(180, ge=0, le=3650)
    swim_test_after: Optional[int] = Field(None, ge=0, le=50)   # None = keep current
    swim_test_valid_months: Optional[int] = Field(None, ge=0, le=240)
    cox_status_valid_months: Optional[int] = Field(None, ge=0, le=240)
    capsize_drill_valid_months: Optional[int] = Field(None, ge=0, le=240)


@router.get("/api/committee/settings")
def settings_get(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        s = db.get_settings(conn)
        s["member_password_custom"] = bool(s.pop("member_password_hash", ""))
        s["novice_land_free"] = s.get("novice_land_free") == "1"
        s.update({k: int_setting(s, k) for k in NUMBER_SETTINGS})
        s["terms"] = TERMS
        s["phone_encryption"] = privacy.enabled()
        s["phone_count"] = conn.execute("SELECT COUNT(*) FROM members WHERE phone != ''").fetchone()[0]
        return s


@router.put("/api/committee/settings")
def settings_put(b: SettingsIn, _: str = Depends(require_committee)):
    if b.current_term not in TERMS:
        raise HTTPException(400, "Bad term")
    for k in ("subs_cutoff", "today_override", "season_start"):
        optional_date(getattr(b, k), f"Bad date: {getattr(b, k)}")
    if b.phone_mode not in ("required", "optional", "off"):
        raise HTTPException(400, "Bad phone setting")
    if b.member_password:
        if len(b.member_password) < 6:
            raise HTTPException(400, "Member password must be at least 6 characters")
        if is_committee_password(b.member_password):
            raise HTTPException(400, "Rower password must differ from the committee password")
    with db.get_conn() as conn:
        for k in NUMBER_SETTINGS:
            if getattr(b, k) is not None:
                db.set_setting(conn, k, str(getattr(b, k)))
        for k in ("club_name", "academic_year", "current_term", "subs_cutoff", "today_override", "season_start", "phone_mode"):
            db.set_setting(conn, k, getattr(b, k).strip())
        db.set_setting(conn, "novice_land_free", "1" if b.novice_land_free else "0")
        privacy.purge_expired(conn, b.phone_retention_days)
        if b.member_password:
            db.set_setting(conn, "member_password_hash", hash_pw(b.member_password))
        return {"ok": True}


@router.post("/api/committee/settings/reset-member-password")
def settings_reset_pw(_: str = Depends(require_committee)):
    with db.get_conn() as conn:
        db.set_setting(conn, "member_password_hash", "")
        return {"ok": True}


@router.get("/api/committee/backup")
def backup(_: str = Depends(require_committee)):
    """Download a consistent snapshot of the SQLite database."""
    path = os.path.join(db.DATA_DIR, "backup.db")
    src = db.connect()
    try:
        dst = db.sqlite3.connect(path)
        src.backup(dst)
        dst.close()
    finally:
        src.close()
    return FileResponse(path, filename=f"outings-backup-{date.today().isoformat()}.db",
                        media_type="application/octet-stream")
