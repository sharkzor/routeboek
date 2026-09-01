"""Weersverwachting per rit via Open-Meteo (gratis, geen API-key nodig).

Open-Meteo's forecast-API levert alleen voorspellingen voor de komende
~16 dagen. Ritten mogen ver vooruit gepland worden, dus buiten dat bereik
geven we gewoon "niet beschikbaar" terug i.p.v. een foutmelding - de
frontend laat de weer-knop dan simpelweg weg.

Resultaten worden 30 minuten in het geheugen gecached per (locatie, datum),
zodat een druk bekeken ritten-overzicht niet bij elke request Open-Meteo
belast.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import date, time as time_cls

import requests

from app.config import get_settings

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
FORECAST_HORIZON_DAYS = 15
CACHE_TTL_SECONDS = 30 * 60

_LOCK = threading.Lock()
_CACHE: dict[str, tuple[float, list[dict]]] = {}


def _cache_key(lat: float, lon: float, target_date: date) -> str:
    # Afronden op ~1km nauwkeurigheid is ruim genoeg voor een weersverwachting.
    return f"{lat:.2f}:{lon:.2f}:{target_date.isoformat()}"


def get_hourly_forecast(
    lat: float, lon: float, target_date: date
) -> list[dict] | None:
    """Haalt het uurlijkse weerbericht op voor een dag, of None als dat niet kan."""
    today = date.today()
    if target_date < today or (target_date - today).days > FORECAST_HORIZON_DAYS:
        return None

    key = _cache_key(lat, lon, target_date)
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]

    settings = get_settings()
    params = {
        "latitude": round(lat, 4),
        "longitude": round(lon, 4),
        "hourly": (
            "temperature_2m,precipitation,precipitation_probability,"
            "weather_code,wind_speed_10m,wind_direction_10m,is_day"
        ),
        "timezone": "Europe/Amsterdam",
        "start_date": target_date.isoformat(),
        "end_date": target_date.isoformat(),
    }
    try:
        response = requests.get(
            OPEN_METEO_URL,
            params=params,
            timeout=8,
            headers={"User-Agent": settings.user_agent},
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Weerbericht ophalen bij Open-Meteo mislukt: %s", exc)
        return None

    hourly = data.get("hourly")
    if not hourly or "time" not in hourly:
        return None

    hours: list[dict] = []
    for i, timestamp in enumerate(hourly["time"]):
        try:
            hours.append(
                {
                    "time": timestamp,  # "2026-09-01T19:00"
                    "temp_c": hourly["temperature_2m"][i],
                    "precipitation_mm": hourly["precipitation"][i],
                    "precipitation_probability": hourly[
                        "precipitation_probability"
                    ][i],
                    "weather_code": hourly["weather_code"][i],
                    "wind_speed_kmh": hourly["wind_speed_10m"][i],
                    "wind_direction_deg": hourly["wind_direction_10m"][i],
                    "is_day": bool(hourly["is_day"][i]),
                }
            )
        except (KeyError, IndexError):
            continue

    with _LOCK:
        _CACHE[key] = (time.time(), hours)
    return hours


def hours_around(
    hourly: list[dict], target_time: time_cls, before: int = 1, after: int = 2
) -> list[dict]:
    """Filtert het uurbericht naar een venster rond het ritvertrek."""
    wanted = {
        h % 24 for h in range(target_time.hour - before, target_time.hour + after + 1)
    }
    picked = []
    for entry in hourly:
        try:
            hour = int(entry["time"][11:13])
        except (KeyError, ValueError, TypeError):
            continue
        if hour in wanted:
            picked.append(entry)
    return picked
