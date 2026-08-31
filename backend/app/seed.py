"""Import van de routes die uit routeboek.cc zijn gehaald.

Idempotent: routes worden gekoppeld op `source_id`. Draai het commando gerust
opnieuw na een nieuwe scrape.

    python -m app.seed
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Route, RouteType, User
from app.rating import recompute_rating
from app.security import hash_password, new_token, normalize_email

logger = logging.getLogger(__name__)

ROUTE_TYPE_MAP = {
    "road": RouteType.road,
    "road_gravel": RouteType.road_gravel,
    "gravel": RouteType.gravel,
}


def seed_file() -> Path:
    return get_settings().data_dir / "seed" / "routes.json"


def import_routes() -> tuple[int, int]:
    """Voeg ontbrekende routes toe en werk bestaande bij. Geeft (nieuw, bijgewerkt)."""
    path = seed_file()
    if not path.is_file():
        logger.warning("Geen seedbestand gevonden op %s", path)
        return 0, 0

    payload = json.loads(path.read_text(encoding="utf-8"))
    created = updated = 0

    with SessionLocal() as db:
        for item in payload.get("routes", []):
            route = db.scalar(
                select(Route).where(Route.source_id == item["source_id"])
            ) or db.scalar(select(Route).where(Route.slug == item["slug"]))

            is_new = route is None
            if route is None:
                route = Route(slug=item["slug"], source_id=item["source_id"])
                db.add(route)

            route.name = item["name"]
            route.description_html = item.get("description_html") or ""
            route.distance_km = item.get("distance_km")
            route.elevation_m = item.get("elevation_m")
            route.route_type = ROUTE_TYPE_MAP.get(
                item.get("route_type") or "road", RouteType.road
            )
            route.wind_directions = item.get("wind_directions") or []
            route.categories = item.get("categories") or []
            route.legacy_rating = item.get("rating")
            route.legacy_rating_count = item.get("rating_count") or 0
            route.strava_url = item.get("strava_url")
            route.gpx_file = item.get("gpx_file")
            route.tcx_file = item.get("tcx_file")
            route.map_file = item.get("map_file")
            route.coordinates = item.get("coordinates") or []
            db.flush()
            recompute_rating(db, route)

            created += is_new
            updated += not is_new
        db.commit()

    logger.info("Routes geïmporteerd: %d nieuw, %d bijgewerkt", created, updated)
    return created, updated


def ensure_admin() -> None:
    """Geef het ingestelde adminadres beheerdersrechten.

    Bestaat het account nog niet, dan wordt het aangemaakt met een willekeurig
    wachtwoord. De beheerder gebruikt daarna 'wachtwoord vergeten'. Zo staat er
    nooit een bekend wachtwoord in de database of in de logs.
    """
    settings = get_settings()
    email = normalize_email(settings.admin_email)
    if not email:
        return

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                display_name=settings.admin_name or email,
                password_hash=hash_password(new_token()),
                is_admin=True,
            )
            db.add(user)
            logger.info(
                "Beheerdersaccount %s aangemaakt. Gebruik 'wachtwoord vergeten' "
                "om een wachtwoord in te stellen.",
                email,
            )
        elif not user.is_admin:
            user.is_admin = True
            logger.info("Bestaand account %s heeft nu beheerdersrechten", email)
        db.commit()


def main() -> int:
    logging.basicConfig(
        level=get_settings().log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    ensure_admin()
    created, updated = import_routes()
    print(f"Klaar: {created} nieuwe routes, {updated} bijgewerkt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
