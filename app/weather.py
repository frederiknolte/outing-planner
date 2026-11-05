"""Weather forecast for a session, from Open-Meteo (free, no API key).

    https://open-meteo.com/en/docs

The hourly forecast for a location is fetched on demand (when someone opens a session)
and cached for an hour, so the whole club opening sessions costs a handful of requests.
Open-Meteo forecasts up to 16 days ahead; further out (or for past sessions) there's
nothing to show. Failures are reported to the client as "unavailable", never as an error
that stops the popup from working.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import date

from .river import OXFORD, interval

API = "https://api.open-meteo.com/v1/forecast"
CACHE_S = 3600
FORECAST_DAYS = 16
HOURLY = ["temperature_2m", "apparent_temperature", "wind_speed_10m", "wind_gusts_10m",
          "wind_direction_10m", "weather_code", "precipitation_probability", "precipitation"]

_cache: dict[tuple, tuple[float, dict]] = {}
_lock = threading.Lock()

# WMO weather codes -> (text, icon key used by the client)
CODES = {
    0: ("Clear", "sun"), 1: ("Mainly clear", "sun"), 2: ("Partly cloudy", "partly"), 3: ("Overcast", "cloud"),
    45: ("Fog", "fog"), 48: ("Freezing fog", "fog"),
    51: ("Light drizzle", "rain"), 53: ("Drizzle", "rain"), 55: ("Heavy drizzle", "rain"),
    56: ("Freezing drizzle", "rain"), 57: ("Heavy freezing drizzle", "rain"),
    61: ("Light rain", "rain"), 63: ("Rain", "rain"), 65: ("Heavy rain", "rain"),
    66: ("Freezing rain", "rain"), 67: ("Heavy freezing rain", "rain"),
    71: ("Light snow", "snow"), 73: ("Snow", "snow"), 75: ("Heavy snow", "snow"), 77: ("Snow grains", "snow"),
    80: ("Light showers", "rain"), 81: ("Showers", "rain"), 82: ("Violent showers", "rain"),
    85: ("Snow showers", "snow"), 86: ("Heavy snow showers", "snow"),
    95: ("Thunderstorm", "storm"), 96: ("Thunderstorm with hail", "storm"), 99: ("Thunderstorm with heavy hail", "storm"),
}
# Worse weather wins when summarising several hours.
_SEVERITY = {"sun": 0, "partly": 1, "cloud": 2, "fog": 3, "rain": 4, "snow": 5, "storm": 6}
COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def _fetch(lat: float, lon: float, timeout: float = 8) -> dict:
    q = urllib.parse.urlencode({
        "latitude": f"{lat:.3f}", "longitude": f"{lon:.3f}", "hourly": ",".join(HOURLY),
        "wind_speed_unit": "mph", "timezone": "Europe/London", "forecast_days": FORECAST_DAYS,
    })
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": "OutingPlanner/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - fixed https URL
        data = json.loads(r.read(2 * 1024 * 1024).decode("utf-8"))
    h = data.get("hourly") or {}
    times = h.get("time") or []
    return {"times": times, **{k: h.get(k) or [None] * len(times) for k in HOURLY}}


def hourly(lat: float, lon: float) -> dict:
    key = (round(lat, 2), round(lon, 2))
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_S:
            return hit[1]
    data = _fetch(lat, lon)
    with _lock:
        _cache[key] = (time.time(), data)
    return data


def _num(xs):
    return [x for x in xs if isinstance(x, (int, float))]


def for_outing(o: dict, place: dict | None, today: date) -> dict:
    """Forecast summary for the session's hours: {available, ...} or {available: False, reason}."""
    try:
        d = date.fromisoformat(o["date"])
    except (KeyError, ValueError):
        return {"available": False, "reason": "No date"}
    if d < today:
        return {"available": False, "reason": "Forecasts are only shown for upcoming sessions."}
    if (d - today).days >= FORECAST_DAYS:
        return {"available": False, "reason": f"The forecast is available up to {FORECAST_DAYS} days ahead."}
    lat, lon = OXFORD
    if place and place.get("lat") is not None and place.get("lon") is not None:
        lat, lon = place["lat"], place["lon"]
    try:
        h = hourly(lat, lon)
    except Exception:  # network, timeout, bad JSON: just say it's unavailable
        return {"available": False, "reason": "The forecast couldn't be loaded right now."}

    iv = interval(o)
    start_h, end_h = (iv[0] // 60, max(iv[0] // 60, (iv[1] - 1) // 60)) if iv else (8, 17)  # no time: the daytime
    idx = [i for i, t in enumerate(h["times"])
           if t.startswith(o["date"]) and start_h <= int(t[11:13]) <= end_h]
    if not idx:
        return {"available": False, "reason": "No forecast for this time yet."}
    pick = lambda k: [h[k][i] for i in idx]
    temps, feels = _num(pick("temperature_2m")), _num(pick("apparent_temperature"))
    wind, gusts, dirs = _num(pick("wind_speed_10m")), _num(pick("wind_gusts_10m")), _num(pick("wind_direction_10m"))
    rain_p, rain_mm = _num(pick("precipitation_probability")), _num(pick("precipitation"))
    codes = [c for c in pick("weather_code") if c in CODES]
    if not temps or not wind:
        return {"available": False, "reason": "No forecast for this time yet."}
    worst = max(codes, key=lambda c: (_SEVERITY[CODES[c][1]], c)) if codes else None
    return {
        "available": True,
        "timed": bool(iv),
        "hours": [h["times"][idx[0]][11:16], f"{end_h + 1:02d}:00"],
        "temp": round(temps[0]), "temp_min": round(min(temps)), "temp_max": round(max(temps)),
        "feels": round(feels[0]) if feels else None,
        "wind": round(max(wind)), "gust": round(max(gusts)) if gusts else None,
        "wind_dir": COMPASS[round(dirs[0] / 22.5) % 16] if dirs else "",
        "condition": CODES[worst][0] if worst is not None else "",
        "icon": CODES[worst][1] if worst is not None else "",
        "rain_chance": max(rain_p) if rain_p else None,
        "rain_mm": round(sum(rain_mm), 1) if rain_mm else None,
        "source": "Open-Meteo",
    }
