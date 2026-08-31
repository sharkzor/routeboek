"""Herberekenen van de weergegeven routewaardering.

De waardering die leden zien is een gewogen gemiddelde van de bevroren
waardering uit het oude routeboek.cc (`legacy_rating`/`legacy_rating_count`,
anoniem, niet aan een account gekoppeld) en de echte stemmen van ingelogde
leden (`RouteRating`). Zo gaat er geen historische informatie verloren zodra
het eerste lid een waardering geeft.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Route, RouteRating


def recompute_rating(db: Session, route: Route) -> None:
    live_sum, live_count = db.execute(
        select(
            func.coalesce(func.sum(RouteRating.value), 0), func.count(RouteRating.id)
        ).where(RouteRating.route_id == route.id)
    ).one()

    legacy_count = route.legacy_rating_count or 0
    total_count = legacy_count + live_count
    if total_count == 0:
        route.rating = None
        route.rating_count = 0
        return

    legacy_sum = (route.legacy_rating or 0) * legacy_count
    route.rating = round((legacy_sum + live_sum) / total_count, 2)
    route.rating_count = total_count
