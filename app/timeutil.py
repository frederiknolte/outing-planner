"""Times of day: parsing free text and normalising to 24-hour "HH:MM".

Stored times are always "HH:MM" (zero-padded), so they sort correctly as text
("06:30" < "19:00"; the old free text "6:30" sorted after "19:00").
"""
from __future__ import annotations

import re
from typing import Optional

_T = r"(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?"


def _hm(h: str, m: Optional[str], ap: Optional[str]) -> Optional[tuple[int, int]]:
    hh, mm = int(h), int(m or 0)
    if ap:
        if hh > 12:
            return None
        hh = hh % 12 + (12 if ap.lower() == "pm" else 0)
    return (hh, mm) if 0 <= hh < 24 and 0 <= mm < 60 else None


def parse_time(text: str):
    """'07:00', '7am', '0730', '17.30', '6:30-8pm' -> (start, end|None) as (h, m); None if unparseable."""
    t = (text or "").strip().lower()
    if not t:
        return None
    mt = re.match(rf"^{_T}\s*(?:-|–|—|to)\s*{_T}$", t)
    if mt:
        end = _hm(mt.group(4), mt.group(5), mt.group(6))
        start = _hm(mt.group(1), mt.group(2), mt.group(3) or mt.group(6))
        if start and end and end <= start and not mt.group(3):
            start = _hm(mt.group(1), mt.group(2), None)
        return (start, end) if start else None
    m1 = re.match(rf"^{_T}$", t)
    if m1:
        s = _hm(m1.group(1), m1.group(2), m1.group(3))
        return (s, None) if s else None
    return None


def fmt(hm: tuple[int, int]) -> str:
    return f"{hm[0]:02d}:{hm[1]:02d}"


def normalize(text: str) -> tuple[str, str]:
    """Free text -> ("HH:MM" start, "HH:MM" end or ""). Unparseable text (e.g. "TBC") is kept as is."""
    p = parse_time(text)
    if not p:
        return (" ".join((text or "").split()), "")
    return (fmt(p[0]), fmt(p[1]) if p[1] else "")


def to_minutes(hhmm: str) -> Optional[int]:
    p = parse_time(hhmm)
    return p[0][0] * 60 + p[0][1] if p else None
