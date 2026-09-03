"""Routes controleren op paden waar fietsen niet mag (alleen Nederland).

De bron is OpenStreetMap. Voor Nederland is die zeer nauwkeurig getagd op
toegankelijkheid (`bicycle`, `access`, `highway`), en het is de enige gratis
bron zonder API-sleutel die dit landsdekkend biedt.

De wegen komen uit een lokale kopie van de kaart (`services/osm_index.py`),
niet uit de Overpass API. Die eerste opzet is geprobeerd en weer verlaten:
één controle kostte drie tot vijf minuten — vrijwel volledig wachttijd — en
na een handvol controles blokkeerden alle drie de publieke Overpass-servers
dit IP-adres. Terecht ook: zo'n gedeelde gratis dienst is niet bedoeld om
routes mee te scannen. Voer die aanpak dus niet opnieuw in.

Met de lokale kaart is het ophalen een R*Tree-query van enkele milliseconden
per stuk route. De hele controle is daarmee sneller dan één Overpass-verzoek
vroeger was, en het antwoord is altijd volledig.

Hoe de controle werkt
---------------------
1. De route wordt om de ~20 m bemonsterd.
2. Per stuk route halen we alle wegen op waarvan de omhullende rechthoek in
   de buurt ligt, en splitsen die in "hier mag je niet fietsen" en de rest.
3. Elk monster dat op een verboden weg ligt én *geen* toegestane weg vlakbij
   heeft, wordt gemarkeerd. Die tweede voorwaarde is de belangrijkste rem op
   valse meldingen: een route over gewone wegen heeft altijd zo'n weg
   vlakbij, terwijl een echt verboden pad op zichzelf staat.
4. Opeenvolgende markeringen worden samengevoegd tot segmenten; te korte
   segmenten vallen af als ruis.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from app.config import get_settings
from app.services import osm_index
from app.water.geo import LocalProjection, haversine_m

logger = logging.getLogger(__name__)

# -- Afstemming --------------------------------------------------------------

#: Zoekvakken van deze grootte langs de route. Klein genoeg om de route
#: strak te volgen, groot genoeg om niet onnodig veel query's te doen.
MAX_BOX_KM = 3.0

#: Marge rond elk zoekvak, ruim boven SNAP_RADIUS_M en ALLOWED_NEARBY_M.
BOX_MARGIN_M = 60.0

#: Om de hoeveel meter we een punt op de route beoordelen.
SAMPLE_SPACING_M = 20.0

#: Maximale afstand waarop een route nog "op" een weg ligt.
SNAP_RADIUS_M = 12.0

#: Ligt er binnen zoveel meter óók een gewone, toegestane weg, dan melden we
#: niets. Een route over legale wegen heeft altijd zo'n weg vlakbij; alleen een
#: echt verboden pad staat op zichzelf. Dit is de belangrijkste rem op valse
#: meldingen: opgeslagen routepunten liggen soms 100 m uit elkaar, en de rechte
#: lijn daartussen snijdt bochten af tot vlak langs een parallel voetpad.
ALLOWED_NEARBY_M = 20.0

#: Een melding moet minstens zo lang zijn; korter is vrijwel altijd ruis
#: doordat de GPS-lijn even naar een parallel pad "overspringt".
MIN_SEGMENT_M = 35.0
MIN_SEGMENT_POINTS = 3

#: Zoveel schone monsters mogen een segment onderbreken zonder het te splitsen.
GAP_TOLERANCE = 2

#: Ophogen zodra de regels of de tegelquery wijzigen; verouderde cache vervalt.
RULESET_VERSION = 2

# -- Regels ------------------------------------------------------------------

#: Waarden van `bicycle` waarmee fietsen expliciet is toegestaan.
_BICYCLE_OK = frozenset(
    {"yes", "designated", "permissive", "official", "destination", "dismount"}
)

_ACCESS_BLOCKED = frozenset({"no", "private"})


def classify(tags: dict[str, str]) -> tuple[str, str, str] | None:
    """Beoordeel een OSM-weg: (severity, code, label) of None als fietsen mag.

    `severity` is "forbidden" (fietsen mag hier niet) of "warning" (mag wel,
    maar niet zonder meer: afstappen, gedoogd, of juridisch onduidelijk).
    """
    highway = tags.get("highway")
    bicycle = tags.get("bicycle")

    # Stoepen en zebrapaden liggen per definitie tegen de rijbaan aan. Ze als
    # overtreding melden zou elke route door de bebouwde kom rood kleuren.
    if highway == "footway" and tags.get("footway") in ("sidewalk", "crossing"):
        return None

    # 1. Expliciete uitspraak over fietsers gaat altijd voor.
    if bicycle == "no":
        return ("forbidden", "bicycle_no", "Fietsen verboden")
    if bicycle == "dismount":
        return ("warning", "dismount", "Afstappen verplicht")
    if bicycle == "use_sidepath":
        return ("warning", "use_sidepath", "Verplicht fietspad ernaast")

    # 2. Autosnelweg en autoweg zijn nooit toegestaan, ook niet met bicycle=yes.
    if highway in ("motorway", "motorway_link") or tags.get("motorroad") == "yes":
        return ("forbidden", "motorway", "Autosnelweg of autoweg")

    explicitly_allowed = bicycle in _BICYCLE_OK

    # 3. Afgesloten terrein, tenzij er voor fietsers een uitzondering staat.
    if not explicitly_allowed:
        if tags.get("access") in _ACCESS_BLOCKED:
            return ("forbidden", "access_private", "Privéterrein of afgesloten")
        if tags.get("vehicle") in _ACCESS_BLOCKED:
            return ("forbidden", "vehicle_no", "Geen voertuigen toegestaan")

    if explicitly_allowed:
        return None

    # 4. Voetgangersinfrastructuur zonder fietsvrijgave.
    if highway == "steps":
        return ("forbidden", "steps", "Trap")
    if highway == "footway":
        return ("forbidden", "footway", "Voetpad")
    if highway == "corridor":
        return ("forbidden", "corridor", "Gang door een gebouw")
    if highway == "pedestrian":
        return ("warning", "pedestrian", "Voetgangersgebied")
    if highway == "bridleway":
        return ("warning", "bridleway", "Ruiterpad")
    if highway == "path":
        # `highway=path` is in Nederland dubbelzinnig. Alleen als het pad
        # nadrukkelijk voor voetgangers is bedoeld melden we het.
        if tags.get("foot") == "designated":
            return ("warning", "path_foot", "Wandelpad")
        return None
    return None


# -- Datastructuren ----------------------------------------------------------


@dataclass(slots=True)
class Way:
    """Een OSM-weg met alleen de tags en geometrie die wij nodig hebben."""

    id: int
    tags: dict[str, str]
    coords: list[tuple[float, float]]


@dataclass(slots=True)
class Segment:
    """Een aaneengesloten stuk route dat een probleem oplevert."""

    severity: str
    code: str
    label: str
    way_id: int | None
    way_name: str | None
    highway: str | None
    start_km: float
    end_km: float
    length_m: float
    coordinates: list[tuple[float, float]]


@dataclass(slots=True)
class Report:
    total_distance_km: float
    forbidden_count: int
    warning_count: int
    segments: list[Segment]
    checked_at: float = field(default_factory=time.time)
    source: str = "OpenStreetMap (Overpass)"


# -- Wegen ophalen -----------------------------------------------------------


def _boxes(
    points: Sequence[tuple[float, float]],
) -> list[tuple[float, float, float, float]]:
    """Deel de route op in zoekvakken.

    Eén vak om de hele route is verleidelijk maar verkeerd: bij een route van
    40 km beslaat dat al gauw 15 bij 15 km met tienduizenden wegen, terwijl we
    er maar een fractie van nodig hebben. Vakken van een paar kilometer volgen
    de route veel strakker en zijn samen een stuk sneller.
    """
    boxes: list[tuple[float, float, float, float]] = []
    span = MAX_BOX_KM * 1000.0
    current: list[tuple[float, float]] = []
    min_lat = min_lon = 90.0
    max_lat = max_lon = -90.0

    def flush() -> None:
        if len(current) < 1:
            return
        # Marge in graden: ruim boven de zoekstralen hieronder, zodat een weg
        # die net buiten het vak begint toch meekomt.
        dlat = BOX_MARGIN_M / 111_320.0
        dlon = dlat / max(0.2, abs(math.cos(math.radians((min_lat + max_lat) / 2))))
        boxes.append((min_lat - dlat, min_lon - dlon, max_lat + dlat, max_lon + dlon))

    for lat, lon in points:
        current.append((lat, lon))
        min_lat, max_lat = min(min_lat, lat), max(max_lat, lat)
        min_lon, max_lon = min(min_lon, lon), max(max_lon, lon)
        height = (max_lat - min_lat) * 111_320.0
        width = (max_lon - min_lon) * 111_320.0 * abs(math.cos(math.radians(lat)))
        if height > span or width > span:
            flush()
            current = [(lat, lon)]
            min_lat = max_lat = lat
            min_lon = max_lon = lon
    flush()
    return boxes


def load_ways(points: Sequence[tuple[float, float]]) -> list[Way]:
    """Alle wegen langs de route, uit de lokale kaart."""
    found: dict[int, Way] = {}
    for min_lat, min_lon, max_lat, max_lon in _boxes(points):
        for way_id, tags, coords in osm_index.ways_in_bbox(
            min_lat, min_lon, max_lat, max_lon
        ):
            if way_id not in found:
                found[way_id] = Way(id=way_id, tags=tags, coords=coords)
    return list(found.values())


def sample_route(
    points: Sequence[tuple[float, float]],
) -> list[tuple[float, float, float]]:
    """Verdeel de route in punten van ~SAMPLE_SPACING_M met hun km-positie."""
    if len(points) < 2:
        return [(points[0][0], points[0][1], 0.0)] if points else []
    samples: list[tuple[float, float, float]] = [(points[0][0], points[0][1], 0.0)]
    travelled = 0.0
    carry = 0.0
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        span = haversine_m(a[0], a[1], b[0], b[1])
        if span <= 0:
            continue
        offset = SAMPLE_SPACING_M - carry
        while offset < span:
            f = offset / span
            samples.append(
                (
                    a[0] + (b[0] - a[0]) * f,
                    a[1] + (b[1] - a[1]) * f,
                    (travelled + offset) / 1000.0,
                )
            )
            offset += SAMPLE_SPACING_M
        carry = (carry + span) % SAMPLE_SPACING_M
        travelled += span
    return samples


class _WayIndex:
    """Ruimtelijke index van wegen, in meters rond een referentiepunt."""

    def __init__(self, ways: Sequence[Way], projection: LocalProjection) -> None:
        self.ways: list[Way] = []
        lines: list[LineString] = []
        for way in ways:
            xy = projection.to_xy_many(way.coords)
            if len(xy) < 2:
                continue
            lines.append(LineString(xy))
            self.ways.append(way)
        self.lines = lines
        self.tree = STRtree(lines) if lines else None

    def nearest_within(
        self, x: float, y: float, radius: float
    ) -> list[tuple[float, Way]]:
        """Wegen binnen `radius`, als (afstand, weg), dichtstbijzijnde eerst."""
        if self.tree is None:
            return []
        point = Point(x, y)
        found: list[tuple[float, Way]] = []
        for index in self.tree.query(point.buffer(radius)):
            distance = self.lines[index].distance(point)
            if distance <= radius:
                found.append((distance, self.ways[index]))
        found.sort(key=lambda item: item[0])
        return found


# -- Controle ----------------------------------------------------------------


def _runs(
    flagged: dict[int, tuple[float, Way, tuple[str, str, str]]],
    samples: Sequence[tuple[float, float, float]],
) -> list[list[int]]:
    """Groepeer opeenvolgende gemarkeerde monsters tot reeksen van betekenis."""
    if not flagged:
        return []
    runs: list[list[int]] = []
    current: list[int] = []
    previous: int | None = None
    for index in sorted(flagged):
        if previous is not None and index - previous > GAP_TOLERANCE + 1:
            runs.append(current)
            current = []
        current.append(index)
        previous = index
    runs.append(current)

    keep: list[list[int]] = []
    for run in runs:
        if len(run) < MIN_SEGMENT_POINTS:
            continue
        length = (samples[run[-1]][2] - samples[run[0]][2]) * 1000.0
        if length >= MIN_SEGMENT_M:
            keep.append(run)
    return keep


def _to_segments(
    flagged: dict[int, tuple[float, Way, tuple[str, str, str]]],
    samples: Sequence[tuple[float, float, float]],
) -> list[Segment]:
    segments: list[Segment] = []
    for run in _runs(flagged, samples):
        first, last = run[0], run[-1]
        coords = [(samples[i][0], samples[i][1]) for i in range(first, last + 1)]
        length = sum(
            haversine_m(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
            for i in range(len(coords) - 1)
        )
        # De zwaarste reden binnen het segment bepaalt het oordeel.
        _, way, (severity, code, label) = max(
            (flagged[i] for i in run),
            key=lambda item: (item[2][0] == "forbidden", -item[0]),
        )
        segments.append(
            Segment(
                severity=severity,
                code=code,
                label=label,
                way_id=way.id,
                way_name=way.tags.get("name"),
                highway=way.tags.get("highway"),
                start_km=round(samples[first][2], 2),
                end_km=round(samples[last][2], 2),
                length_m=round(length, 1),
                coordinates=coords,
            )
        )
    segments.sort(key=lambda s: s.start_km)
    return segments


def check_route(
    points: Sequence[tuple[float, float]],
    progress: Callable[[float, str], None] | None = None,
) -> Report:
    """Controleer een route op stukken waar fietsen niet (zonder meer) mag."""

    def report_progress(value: float, message: str) -> None:
        if progress is not None:
            progress(min(0.99, value), message)

    samples = sample_route(points)
    total_km = samples[-1][2] if samples else 0.0
    if len(samples) < 2:
        return Report(total_km, 0, 0, [])

    projection = LocalProjection.from_points(points)
    report_progress(0.05, "Kaartgegevens opzoeken")

    ways = load_ways(points)
    problematic: list[Way] = []
    allowed: list[Way] = []
    for way in ways:
        (problematic if classify(way.tags) is not None else allowed).append(way)

    report_progress(0.88, "Route langs de kaart leggen")

    problem_index = _WayIndex(problematic, projection)
    allowed_index = _WayIndex(allowed, projection)

    flagged: dict[int, tuple[float, Way, tuple[str, str, str]]] = {}
    for i, (lat, lon, _km) in enumerate(samples):
        x, y = projection.to_xy(lat, lon)
        near = problem_index.nearest_within(x, y, SNAP_RADIUS_M)
        if not near:
            continue
        distance, way = near[0]
        if allowed_index.nearest_within(x, y, ALLOWED_NEARBY_M):
            continue
        verdict = classify(way.tags)
        if verdict is not None:
            flagged[i] = (distance, way, verdict)

    report_progress(0.95, "Meldingen samenvoegen")
    segments = _to_segments(flagged, samples)
    return Report(
        total_distance_km=round(total_km, 2),
        forbidden_count=sum(1 for s in segments if s.severity == "forbidden"),
        warning_count=sum(1 for s in segments if s.severity == "warning"),
        segments=segments,
    )


# -- Achtergrondtaken --------------------------------------------------------

# De controle duurt bij een koude cache tientallen seconden; te lang voor één
# HTTP-verzoek achter de reverse proxy. De frontend start hem daarom en vraagt
# de voortgang op.


@dataclass
class Job:
    status: str = "running"  # running | done | error
    progress: float = 0.0
    message: str = "Bezig met voorbereiden"
    report: Report | None = None
    error: str | None = None
    started_at: float = field(default_factory=time.time)


_JOBS: dict[str, Job] = {}
_JOBS_LOCK = threading.Lock()
_POOL = ThreadPoolExecutor(max_workers=2)


def _report_cache_path(key: str) -> Path:
    base = get_settings().cache_dir / "route_legality" / f"v{RULESET_VERSION}"
    return base / f"{key}.json"


def coordinates_key(points: Sequence[tuple[float, float]]) -> str:
    raw = ";".join(f"{lat:.5f},{lon:.5f}" for lat, lon in points)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _store(key: str, report: Report) -> None:
    path = _report_cache_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "total_distance_km": report.total_distance_km,
        "forbidden_count": report.forbidden_count,
        "warning_count": report.warning_count,
        "checked_at": report.checked_at,
        "source": report.source,
        "segments": [
            {
                "severity": s.severity,
                "code": s.code,
                "label": s.label,
                "way_id": s.way_id,
                "way_name": s.way_name,
                "highway": s.highway,
                "start_km": s.start_km,
                "end_km": s.end_km,
                "length_m": s.length_m,
                "coordinates": [list(c) for c in s.coordinates],
            }
            for s in report.segments
        ],
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(path)


def load_cached(key: str) -> Report | None:
    path = _report_cache_path(key)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    return Report(
        total_distance_km=payload["total_distance_km"],
        forbidden_count=payload["forbidden_count"],
        warning_count=payload["warning_count"],
        checked_at=payload.get("checked_at", 0.0),
        source=payload.get("source", "OpenStreetMap (Overpass)"),
        segments=[
            Segment(
                severity=s["severity"],
                code=s["code"],
                label=s["label"],
                way_id=s.get("way_id"),
                way_name=s.get("way_name"),
                highway=s.get("highway"),
                start_km=s["start_km"],
                end_km=s["end_km"],
                length_m=s["length_m"],
                coordinates=[tuple(c) for c in s["coordinates"]],
            )
            for s in payload.get("segments", [])
        ],
    )


def get_job(key: str) -> Job | None:
    with _JOBS_LOCK:
        return _JOBS.get(key)


def start(key: str, points: Sequence[tuple[float, float]]) -> Job:
    """Start de controle, of geef de lopende taak terug."""
    with _JOBS_LOCK:
        existing = _JOBS.get(key)
        if existing is not None and existing.status == "running":
            return existing
        job = Job()
        _JOBS[key] = job

    def run() -> None:
        try:
            def progress(value: float, message: str) -> None:
                job.progress = value
                job.message = message

            report = check_route(points, progress)
            _store(key, report)
            job.report = report
            job.progress = 1.0
            job.message = "Klaar"
            job.status = "done"
        except Exception as exc:  # noqa: BLE001
            logger.exception("Controle op verboden paden mislukt")
            job.error = str(exc)
            job.status = "error"

    _POOL.submit(run)
    return job
