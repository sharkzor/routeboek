"""Datastructuren voor route- en waterpuntverwerking.

Overgenomen uit de gpx-waterpunten applicatie (/home/shark/gpx).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class RoutePoint:
    """Eén punt op de route."""

    lat: float
    lon: float
    ele: float | None = None


@dataclass(slots=True)
class WaterPoint:
    """Een drinkwaterpunt met optionele metadata."""

    lat: float
    lon: float
    name: str | None = None
    operator: str | None = None
    opening_hours: str | None = None
    website: str | None = None
    source: str = "onbekend"
    ele: float | None = None
    description: str | None = None
    # Ingevuld tijdens routeberekening:
    distance_to_route_m: float = 0.0
    along_route_km: float = 0.0
    extra: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class RoadWork:
    """Een geplande wegwerkzaamheid die fietsers raakt.

    Nog niet in gebruik in het routeboek, maar het GPX-schrijfgedeelte is
    overgenomen zodat de module later zonder aanpassing kan worden uitgebreid.
    """

    lat: float
    lon: float
    start: str | None = None
    end: str | None = None
    cause: str | None = None
    authority: str | None = None
    detour: str | None = None
    comment: str | None = None
    distance_to_route_m: float = 0.0
    along_route_km: float = 0.0


@dataclass(slots=True)
class RouteStats:
    """Analysegegevens over een route en de gevonden waterpunten."""

    total_distance_km: float
    water_point_count: int
    average_gap_km: float | None
    longest_gap_km: float
    longest_gap_start_km: float
    warning: str | None
    has_elevation: bool
