"""Windrichting inschatten voor routes zonder handmatige tag.

Idee (van de club): je fietst het stuk weg van huis het liefst tegen de wind
in, zodat je op de terugweg de wind mee hebt. We nemen het verst van het
startpunt gelegen punt op de route als (ruwe) keerpunt en de kompaskoers
ernaartoe bepaalt welke windrichting we als "favoriet" instellen.

Idempotent en behoudend: routes met al een windrichting (handmatig of eerder
geschat) worden overgeslagen. Alleen bruikbaar als hulp; een clublid mag dit
via de beheerpagina altijd corrigeren (dat wist automatisch de schatting).

    python -m app.estimate_wind
"""

from __future__ import annotations

import logging
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Route
from app.water.geo import estimate_wind_direction

logger = logging.getLogger(__name__)


def estimate_missing_wind() -> tuple[int, int]:
    """Vul wind_directions in waar die leeg is. Geeft (bijgewerkt, overgeslagen)."""
    updated = 0
    skipped = 0
    with SessionLocal() as db:
        routes = db.scalars(select(Route)).all()
        for route in routes:
            if route.wind_directions:
                continue
            if not route.coordinates or len(route.coordinates) < 2:
                skipped += 1
                continue
            points = [(p[0], p[1]) for p in route.coordinates]
            guess = estimate_wind_direction(points)
            if guess is None:
                skipped += 1
                continue
            route.wind_directions = [guess]
            route.wind_estimated = True
            updated += 1
        db.commit()
    return updated, skipped


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    updated, skipped = estimate_missing_wind()
    logger.info(
        "%d routes van een geschatte windrichting voorzien, %d overgeslagen "
        "(geen coordinaten).",
        updated,
        skipped,
    )


if __name__ == "__main__":
    sys.exit(main())
