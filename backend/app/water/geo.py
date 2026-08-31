"""Geometrische hulpfuncties: lokale metrische projectie."""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

class LocalProjection:
    """Equirectangulaire projectie rond een referentiepunt, in meters.

    Nauwkeurig genoeg (<0.1% fout) voor routes van enkele honderden km.
    """

    __slots__ = ("lat0", "lon0", "_mx", "_my")

    def __init__(self, lat0: float, lon0: float) -> None:
        self.lat0 = lat0
        self.lon0 = lon0
        self._my = _DEG_LAT_M
        self._mx = _DEG_LAT_M * math.cos(math.radians(lat0))

    @classmethod
    def from_points(cls, points: Sequence[tuple[float, float]]) -> "LocalProjection":
        if not points:
            return cls(52.0, 5.0)
        lat0 = sum(p[0] for p in points) / len(points)
        lon0 = sum(p[1] for p in points) / len(points)
        return cls(lat0, lon0)

    def to_xy(self, lat: float, lon: float) -> tuple[float, float]:
        return ((lon - self.lon0) * self._mx, (lat - self.lat0) * self._my)

    def to_xy_many(
        self, points: Iterable[tuple[float, float]]
    ) -> list[tuple[float, float]]:
        return [self.to_xy(lat, lon) for lat, lon in points]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Afstand in meters tussen twee coordinaten."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bounding_box(
    points: Sequence[tuple[float, float]], margin_m: float = 0.0
) -> tuple[float, float, float, float]:
    """(min_lat, min_lon, max_lat, max_lon) met optionele marge in meters."""
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    if margin_m:
        dlat = margin_m / _DEG_LAT_M
        mid = (min_lat + max_lat) / 2
        dlon = margin_m / max(1.0, _DEG_LAT_M * math.cos(math.radians(mid)))
        min_lat, max_lat = min_lat - dlat, max_lat + dlat
        min_lon, max_lon = min_lon - dlon, max_lon + dlon
    return min_lat, min_lon, max_lat, max_lon
