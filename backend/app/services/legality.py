"""Routes controleren op paden waar fietsen niet mag (alleen Nederland).

De bron is OpenStreetMap via de Overpass API. OSM is voor Nederland zeer
nauwkeurig getagd op toegankelijkheid (`bicycle`, `access`, `highway`), en het
is de enige gratis bron zonder API-sleutel die dit landsdekkend biedt.

Waarom de route in blokken wordt opgevraagd
------------------------------------------
Overpass kan "alles binnen X meter van deze polyline" (`around:`), precies wat
we nodig hebben. Twee valkuilen, allebei gemeten op de publieke instances:

* De hele route in één keer werkt niet. Een corridor van 300+ punten draait
  meer dan twee minuten en geeft dan een leeg antwoord terug.
* Het tagfilter moet *in* de `around`-query staan. Eerst alle wegen ophalen en
  daarna filteren (`way(around:...)->.w; way.w[...]`) loopt bij elke grootte in
  een timeout, omdat Overpass dan zijn index niet kan gebruiken. Om dezelfde
  reden krijgt elke `bicycle=`/`access=`-clausule er `["highway"]` bij.

In blokken van ~150 punten is het wel snel (4-9 s per blok, ~100 kB). Een
route van 30 km kost zo drie verzoeken, de langste clubroute (318 km) een
stuk of twintig. Een variant die het gebied in vaste kaartvakken opdeelde is
geprobeerd en weer verworpen: die haalt de hele omgeving op in plaats van
alleen de corridor en was ruim vijf keer zo traag.

Het eindrapport wordt op schijf gecachet zodat een tweede controle van
dezelfde route gratis is, en de losse blokken ook — dat scheelt bij routes die
elkaar overlappen.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Sequence

import requests
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from app.config import get_settings
from app.water.geo import LocalProjection, haversine_m

logger = logging.getLogger(__name__)

# -- Afstemming --------------------------------------------------------------

#: Corridorbreedte: wegen binnen zoveel meter van de routelijn halen we op.
#: Ruim boven ALLOWED_NEARBY_M, met marge voor de vereenvoudiging hieronder.
CORRIDOR_RADIUS_M = 35

#: Zoveel meter mag de lijn die we naar Overpass sturen van de echte route
#: afwijken. Overpass vat een `around` met meerdere coördinaten op als een
#: polyline, niet als losse punten, dus op een recht stuk zijn twee punten
#: genoeg. Vereenvoudigen (Douglas-Peucker) scheelt daardoor ruim de helft
#: van de punten zonder dat de corridor smaller wordt.
SIMPLIFY_TOLERANCE_M = 5.0

#: Corridorlengte per Overpass-verzoek. De echte kostenfactor is niet de
#: lengte maar het aantal wegen in de corridor, en dat scheelt een orde van
#: grootte tussen polder en stad: 10 km door het IJsselmeergebied kost ~4 s,
#: dezelfde 10 km rond Utrecht loopt op élke instance in een 504. We beginnen
#: daarom ruim en halveren een blok dat niet lukt (`_fetch_chunk_adaptive`),
#: zodat we in leeg gebied weinig verzoeken doen en in de stad vanzelf fijner
#: werken.
MAX_CHUNK_KM = 8.0

#: Onder deze lengte heeft verder opdelen geen zin meer.
MIN_CHUNK_KM = 1.0

#: Harde bovengrens per verzoek, voor het geval een stuk extreem bochtig is.
MAX_CHUNK_VERTICES = 120

#: Opgehaalde blokken blijven een maand bruikbaar; OSM verandert langzaam genoeg.
CACHE_TTL_SECONDS = 30 * 86400

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

#: Kort houden: een geslaagde query duurt seconden, geen minuten.
OVERPASS_TIMEOUT_S = 45
OVERPASS_ATTEMPTS = 4

#: De publieke Overpass geeft elk IP twee gelijktijdige plekken.
OVERPASS_CONCURRENCY = 2

OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

#: Alleen deze tags zijn nodig; de rest gooien we weg voordat we cachen.
KEEP_TAGS = (
    "highway",
    "bicycle",
    "access",
    "vehicle",
    "foot",
    "footway",
    "motorroad",
    "service",
    "name",
    "designation",
)

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


# -- Overpass ----------------------------------------------------------------


def simplify_line(
    points: Sequence[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Vereenvoudig de routelijn met Douglas-Peucker, in meters."""
    if len(points) < 3:
        return [tuple(p) for p in points]
    projection = LocalProjection.from_points(points)
    line = LineString(projection.to_xy_many(points)).simplify(SIMPLIFY_TOLERANCE_M)
    return [projection.to_latlon(x, y) for x, y in line.coords]


def corridor_chunks(
    points: Sequence[tuple[float, float]],
) -> list[list[tuple[float, float]]]:
    """Knip de routelijn in stukken die Overpass in één keer aankan.

    De stukken overlappen één punt, zodat de corridor aaneengesloten blijft.
    """
    line = simplify_line(points)
    if len(line) < 2:
        return []

    chunks: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = [line[0]]
    length = 0.0
    for previous, point in zip(line, line[1:]):
        length += haversine_m(previous[0], previous[1], point[0], point[1])
        current.append(point)
        if length >= MAX_CHUNK_KM * 1000 or len(current) >= MAX_CHUNK_VERTICES:
            chunks.append(current)
            current = [point]
            length = 0.0
    if len(current) > 1:
        chunks.append(current)
    return chunks


class OverpassBusy(RuntimeError):
    """De instance wil even niet (rate limit). Wachten helpt."""


class OverpassTooHeavy(RuntimeError):
    """De query is te zwaar voor de server. Alleen kleiner maken helpt."""


def _overpass(query: str, timeout: int = OVERPASS_TIMEOUT_S) -> dict:
    """Voer een Overpass-query uit langs de beschikbare instances.

    Het onderscheid tussen de twee foutsoorten is belangrijk voor de snelheid:
    een 429 gaat over ons (te veel verzoeken, even wachten), een 504 of een
    read-timeout gaat over de query (te zwaar; dan is nog eens proberen puur
    tijdverlies en moet de corridor kleiner). De timeout is bewust kort — een
    geslaagde query is in enkele seconden klaar.
    """
    settings = get_settings()
    heavy = 0
    busy = 0
    last: Exception | None = None

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = requests.post(
                endpoint,
                data={"data": query},
                timeout=timeout,
                headers={"User-Agent": settings.user_agent},
            )
            if response.status_code == 429:
                raise OverpassBusy(f"{endpoint} gaf 429")
            if response.status_code in (502, 503, 504):
                raise OverpassTooHeavy(f"{endpoint} gaf {response.status_code}")
            response.raise_for_status()
            return response.json()
        except OverpassBusy as exc:
            busy += 1
            last = exc
        except requests.Timeout as exc:
            heavy += 1
            last = exc
        except Exception as exc:  # noqa: BLE001 - overige fouten: volgende proberen
            if isinstance(exc, OverpassTooHeavy):
                heavy += 1
            last = exc
        logger.warning("Overpass %s mislukt: %s", endpoint, last)

    if heavy and not busy:
        raise OverpassTooHeavy(str(last))
    raise OverpassBusy(str(last))


def _prune(elements: Iterable[dict]) -> list[dict]:
    """Bewaar per weg alleen de tags en geometrie die we gebruiken."""
    out: list[dict] = []
    for element in elements:
        geometry = element.get("geometry") or []
        if len(geometry) < 2:
            continue
        tags = element.get("tags") or {}
        out.append(
            {
                "id": element.get("id"),
                "t": {k: tags[k] for k in KEEP_TAGS if k in tags},
                "g": [[round(p["lat"], 6), round(p["lon"], 6)] for p in geometry],
            }
        )
    return out


def _chunk_cache_path(chunk: Sequence[tuple[float, float]]) -> Path:
    raw = ";".join(f"{lat:.5f},{lon:.5f}" for lat, lon in chunk)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
    base = get_settings().cache_dir / "osm_legality" / f"v{RULESET_VERSION}"
    return base / f"{digest}.json.gz"


def _fetch_chunk(chunk: Sequence[tuple[float, float]]) -> list[Way]:
    """Haal álle wegen langs één stuk routelijn op, met schijfcache.

    We vragen bewust niet alleen de problematische wegen op. Zonder de
    toegestane wegen ernaast weten we namelijk niet of een melding echt is: een
    voetpad langs de rijbaan ligt vaak binnen een paar meter van de route, en
    dat zou anders elke stoep tot overtreding maken. Bovendien blijkt het
    brede filter (`way["highway"]`) in de praktijk sneller dan de smalle
    variant met zeven losse tagclausules.
    """
    path = _chunk_cache_path(chunk)
    if path.is_file() and (time.time() - path.stat().st_mtime) < CACHE_TTL_SECONDS:
        try:
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                raw = json.load(handle)
            return [Way(w["id"], w["t"], [tuple(c) for c in w["g"]]) for w in raw]
        except Exception:  # noqa: BLE001 - kapotte cache: gewoon opnieuw ophalen
            logger.warning("Cachebestand %s onleesbaar, opnieuw ophalen", path)

    line = ",".join(f"{lat:.5f},{lon:.5f}" for lat, lon in chunk)
    query = (
        "[out:json][timeout:120];"
        f'way["highway"](around:{CORRIDOR_RADIUS_M},{line});'
        "out tags geom;"
    )
    pruned = _prune(_overpass(query).get("elements", []))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as handle:
        json.dump(pruned, handle, separators=(",", ":"))
    tmp.replace(path)
    return [Way(w["id"], w["t"], [tuple(c) for c in w["g"]]) for w in pruned]


def _chunk_length_km(chunk: Sequence[tuple[float, float]]) -> float:
    return (
        sum(haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(chunk, chunk[1:]))
        / 1000.0
    )


def _split(chunk: Sequence[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    """Halveer een blok, met één punt overlap zodat de corridor aaneengesloten blijft."""
    if len(chunk) < 4:
        return []
    middle = len(chunk) // 2
    return [list(chunk[: middle + 1]), list(chunk[middle:])]


def _fetch_chunk_adaptive(chunk: Sequence[tuple[float, float]]) -> list[Way]:
    """Haal een blok op; is het te zwaar, dan in twee helften opnieuw."""
    for attempt in range(OVERPASS_ATTEMPTS):
        try:
            return _fetch_chunk(chunk)
        except OverpassTooHeavy as exc:
            halves = _split(chunk) if _chunk_length_km(chunk) > MIN_CHUNK_KM else []
            if not halves:
                raise
            logger.info("Corridorblok te zwaar (%s); in tweeën gedeeld", exc)
            ways: list[Way] = []
            for half in halves:
                ways.extend(_fetch_chunk_adaptive(half))
            return ways
        except OverpassBusy:
            if attempt == OVERPASS_ATTEMPTS - 1:
                raise
            time.sleep(min(10.0, 3.0 * (attempt + 1)))
    return []


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
    chunks = corridor_chunks(points)
    if not chunks:
        return Report(round(total_km, 2), 0, 0, [])
    report_progress(0.02, "Kaartgegevens ophalen")

    ways: list[Way] = []
    done = 0

    def fetch(chunk: list[tuple[float, float]]) -> list[Way]:
        return _fetch_chunk_adaptive(chunk)

    # Twee tegelijk: precies wat de publieke Overpass per IP toestaat
    # ("Rate limit: 2" in /api/status).
    #
    # Een blok dat definitief niet lukt is een harde fout, geen detail dat we
    # mogen negeren. Missen we de kaartgegevens van een stuk route, dan zouden
    # we daar "geen verboden paden" melden terwijl we simpelweg niet gekeken
    # hebben — precies het antwoord waar je niets aan hebt. De geslaagde
    # blokken staan in de cache, dus een nieuwe poging is goedkoop en vult
    # alleen de ontbrekende stukken aan.
    with ThreadPoolExecutor(max_workers=OVERPASS_CONCURRENCY) as pool:
        for result in pool.map(fetch, chunks):
            ways.extend(result)
            done += 1
            report_progress(
                0.02 + 0.84 * (done / len(chunks)),
                f"Kaartgegevens ophalen ({done}/{len(chunks)})",
            )

    # Eén weg kan in meerdere blokken voorkomen.
    unique: dict[int, Way] = {way.id: way for way in ways}
    problematic: list[Way] = []
    allowed: list[Way] = []
    for way in unique.values():
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
