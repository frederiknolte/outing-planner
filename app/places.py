"""Saved places (boathouse, gym, ...): an outing's or event's location links to maps and the weather forecast."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import require_committee, require_member
from .common import unique_name

router = APIRouter()


class PlaceIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    address: str = Field("", max_length=300)
    coords: str = Field("", max_length=80)   # "51.74, -1.25" or a Google Maps link containing @lat,lon


def _parse_coords(text: str) -> tuple[Optional[float], Optional[float]]:
    text = (text or "").strip()
    if not text:
        return None, None
    m = re.search(r"@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)", text) or \
        re.search(r"(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)", text)
    if not m:
        raise HTTPException(400, "Coordinates not recognised. Use e.g. 51.7436, -1.2521")
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(400, "Coordinates out of range")
    return lat, lon


def _fields(b: PlaceIn) -> tuple:
    return (b.name.strip(), b.address.strip(), *_parse_coords(b.coords))


@router.get("/api/places")
def places_list(role: str = Depends(require_member)):
    with db.get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM places ORDER BY name")]


@router.post("/api/committee/places")
def place_create(b: PlaceIn, _: str = Depends(require_committee)):
    fields = _fields(b)
    with db.get_conn() as conn, unique_name("place"):
        return {"id": conn.execute("INSERT INTO places(name, address, lat, lon) VALUES (?,?,?,?)", fields).lastrowid}


@router.put("/api/committee/places/{place_id}")
def place_update(place_id: int, b: PlaceIn, _: str = Depends(require_committee)):
    fields = _fields(b)
    with db.get_conn() as conn, unique_name("place"):
        conn.execute("UPDATE places SET name=?, address=?, lat=?, lon=? WHERE id=?", fields + (place_id,))
        return {"ok": True}


@router.delete("/api/committee/places/{place_id}")
def place_delete(place_id: int, _: str = Depends(require_committee)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM places WHERE id=?", (place_id,))
        return {"ok": True}
