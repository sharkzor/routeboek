"""Gedeelde hulpfuncties voor het aanmaken van routes.

Gebruikt door zowel de beheer-upload (`routers/admin.py`) als het aanmaken
van community routes (`routers/community.py`), zodat slugs en trackstatistieken
overal op dezelfde manier worden bepaald.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Route
from app.water.geo import haversine_m
from app.water.types import RoutePoint


def slugify(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:150] or "route"


def unique_slug(db: Session, base: str) -> str:
    slug = base
    counter = 2
    while db.scalar(select(Route.id).where(Route.slug == slug)) is not None:
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def track_stats(points: Sequence[RoutePoint]) -> tuple[float, int]:
    """Afstand in km (great-circle) en totale stijging in meters."""
    distance = 0.0
    for a, b in zip(points, points[1:]):
        distance += haversine_m(a.lat, a.lon, b.lat, b.lon)

    elevation = 0.0
    previous: float | None = None
    for point in points:
        if point.ele is None:
            continue
        if previous is not None and point.ele > previous:
            elevation += point.ele - previous
        previous = point.ele
    return round(distance / 1000.0, 1), int(round(elevation))
