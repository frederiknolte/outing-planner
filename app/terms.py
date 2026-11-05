"""Oxford Full Term dates.

Full Term is eight weeks, Sunday of 1st week to Saturday of 8th week. Dates come from
https://www.ox.ac.uk/about/the-university/facts-and-figures/dates-of-term; add new years to
FULL_TERMS when the University publishes them. For years not in the table the dates are
estimated from the usual pattern (Michaelmas starts on the Sunday between 7 and 13 October,
Hilary 14 weeks later, Trinity usually 14 weeks after that, but later when Easter is late,
e.g. 2030), and marked as estimated so the committee checks them.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

TERMS = ["Michaelmas", "Hilary", "Trinity"]

# academic year -> Sunday of 1st week, per term
FULL_TERMS: dict[str, dict[str, str]] = {
    "2025-26": {"Michaelmas": "2025-10-12", "Hilary": "2026-01-18", "Trinity": "2026-04-26"},
    "2026-27": {"Michaelmas": "2026-10-11", "Hilary": "2027-01-17", "Trinity": "2027-04-25"},
    "2027-28": {"Michaelmas": "2027-10-10", "Hilary": "2028-01-16", "Trinity": "2028-04-23"},
    "2028-29": {"Michaelmas": "2028-10-08", "Hilary": "2029-01-14", "Trinity": "2029-04-22"},
    "2029-30": {"Michaelmas": "2029-10-07", "Hilary": "2030-01-13", "Trinity": "2030-04-28"},
    "2030-31": {"Michaelmas": "2030-10-13", "Hilary": "2031-01-19", "Trinity": "2031-04-27"},
    "2031-32": {"Michaelmas": "2031-10-12", "Hilary": "2032-01-18", "Trinity": "2032-04-25"},
    "2032-33": {"Michaelmas": "2032-10-10", "Hilary": "2033-01-16", "Trinity": "2033-04-24"},
}


def ay_start_year(ay: str) -> Optional[int]:
    """'2026-27' -> 2026 (also '2026/2027'); None if it can't be read."""
    m = re.match(r"^\s*(\d{4})\s*[-/–]\s*(\d{2}|\d{4})\s*$", ay or "")
    return int(m.group(1)) if m else None


def ay_label(y: int) -> str:
    return f"{y}-{(y + 1) % 100:02d}"


def ay_start_of(d) -> int:
    """The academic (rowing) year a date falls in, by its start year. The year runs September to August."""
    return d.year if d.month >= 9 else d.year - 1


def next_academic_year(ay: str) -> str:
    """'2026-27' -> '2027-28'; '' if it can't be read."""
    y = ay_start_year(ay)
    return ay_label(y + 1) if y is not None else ""


def next_term(ay: str, term: str) -> tuple[str, str]:
    """The term after (ay, term): Michaelmas -> Hilary -> Trinity -> next year's Michaelmas."""
    i = TERMS.index(term) if term in TERMS else 2
    return (next_academic_year(ay), TERMS[0]) if i == 2 else (ay, TERMS[i + 1])


def full_term(ay: str, term: str) -> Optional[dict]:
    """{"start", "end", "official"} for that term, or None if the academic year can't be read."""
    y = ay_start_year(ay)
    if y is None or term not in TERMS:
        return None
    known = FULL_TERMS.get(ay_label(y), {}).get(term)
    if known:
        start = date.fromisoformat(known)
    else:
        oct7 = date(y, 10, 7)
        start = oct7 + timedelta(days=(6 - oct7.weekday()) % 7) + timedelta(weeks=14 * TERMS.index(term))
    return {"start": start.isoformat(), "end": (start + timedelta(weeks=8, days=-1)).isoformat(), "official": bool(known)}


def term_before(d: date) -> tuple[str, str, date]:
    """The latest term whose Full Term started on or before `d` (d may be in the vacation after it)."""
    best = None
    for y in (d.year - 2, d.year - 1, d.year):
        for t in TERMS:
            s = date.fromisoformat(full_term(ay_label(y), t)["start"])
            if s <= d and (best is None or s > best[2]):
                best = (ay_label(y), t, s)
    return best


def shift_to_next_term(iso: str) -> str:
    """Move a date to the same point (week and weekday) of the following term.

    E.g. Friday of 2nd week of Michaelmas -> Friday of 2nd week of Hilary. A date in the vacation keeps
    its distance from whichever is nearer: the end of the term before it (e.g. 9th week) or the start of
    the term after it (e.g. 0th week). '' if `iso` isn't a date.
    """
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return ""
    ay, t, start = term_before(d)
    term = full_term(ay, t)
    after = next_term(ay, t)
    following = full_term(*after)
    end, upcoming = date.fromisoformat(term["end"]), date.fromisoformat(following["start"])
    if d <= end:
        return (upcoming + (d - start)).isoformat()
    if (d - end) <= (upcoming - d):            # just after a term: same distance after the next term's end
        return (date.fromisoformat(following["end"]) + (d - end)).isoformat()
    beyond = full_term(*next_term(*after))     # just before a term: same distance before the one after it
    return (date.fromisoformat(beyond["start"]) - (upcoming - d)).isoformat()
