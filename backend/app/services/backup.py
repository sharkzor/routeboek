"""Backup en restore van de database (en optioneel de mediabestanden).

Een backup is één `.tar.gz` met een vaste indeling:

    routeboek-<soort>-<YYYYMMDD-HHMM>.tar.gz
    ├── manifest.json      versie, alembic-revisie, tijdstip, soort, media ja/nee
    ├── database.dump      pg_dump --format=custom
    └── media/             alleen bij een volledige backup

Het manifest maakt een restore controleerbaar: een bestand zonder herkenbaar
manifest wordt geweigerd voordat er ook maar iets wordt uitgepakt.

Soorten:

- ``auto``   nachtelijke databasebackup (01:00)
- ``weekly`` extra kopie in de nacht van zaterdag op zondag
- ``manual`` met de knop op de beheerpagina

Retentie ruimt alleen ``auto`` en ``weekly`` op. Een handmatige backup blijft
staan: wie er vóór een riskante actie zelf een maakt, wil niet dat de nachtelijke
ronde die weggooit.

**Let op:** een backup bevat het SMTP-wachtwoord en het Telegram-bot-token, want
die staan sinds de instellingen-in-de-database in `app_settings`. De `SECRET_KEY`
zit er bewust *niet* in (die staat in `data/secret.key`), zodat een gelekt
backupbestand geen sessies of herstel-tokens kan vervalsen.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import tarfile
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Callable, Literal

from app.config import get_settings

logger = logging.getLogger(__name__)

MANIFEST_NAME = "manifest.json"
DUMP_NAME = "database.dump"
MEDIA_DIR_NAME = "media"
FORMAT_VERSION = 1

BackupKind = Literal["auto", "weekly", "manual"]

#: Strikt: alleen namen die deze functie zelf maakt of die een beheerder heeft
#: geüpload. Voorkomt padtrucs, net als `_media_path()` in routers/routes.py.
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+\.tar\.gz$")

KEEP_AUTO = 3
KEEP_WEEKLY = 1

BACKUP_HOUR = 1


# ------------------------------------------------------------------- paden


def backup_dir() -> Path:
    path = get_settings().data_dir / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve(name: str) -> Path:
    """Zet een backupnaam om in een pad binnen de backupmap, of weiger hem."""
    if not SAFE_NAME.match(name):
        raise ValueError("Ongeldige backupnaam.")
    root = backup_dir().resolve()
    path = (root / name).resolve()
    if path.parent != root:
        raise ValueError("Ongeldige backupnaam.")
    return path


def _dsn() -> str:
    """De DATABASE_URL in de vorm die libpq begrijpt."""
    return get_settings().database_url.replace("postgresql+psycopg://", "postgresql://")


# -------------------------------------------------------------- inventaris


@dataclass(slots=True)
class BackupInfo:
    name: str
    kind: str
    size_bytes: int
    created_at: datetime
    has_media: bool
    alembic_revision: str | None = None


def _read_manifest(path: Path) -> dict:
    try:
        with tarfile.open(path, "r:gz") as tar:
            member = tar.getmember(MANIFEST_NAME)
            handle = tar.extractfile(member)
            if handle is None:
                return {}
            return json.loads(handle.read().decode("utf-8"))
    except Exception:
        logger.debug("Geen leesbaar manifest in %s", path.name, exc_info=True)
        return {}


def list_backups() -> list[BackupInfo]:
    out: list[BackupInfo] = []
    for path in sorted(backup_dir().glob("*.tar.gz"), reverse=True):
        stat = path.stat()
        manifest = _read_manifest(path)
        created = manifest.get("created_at")
        try:
            created_at = (
                datetime.fromisoformat(created)
                if created
                else datetime.fromtimestamp(stat.st_mtime).astimezone()
            )
        except ValueError:
            created_at = datetime.fromtimestamp(stat.st_mtime).astimezone()
        out.append(
            BackupInfo(
                name=path.name,
                kind=manifest.get("kind", "onbekend"),
                size_bytes=stat.st_size,
                created_at=created_at,
                has_media=bool(manifest.get("has_media")),
                alembic_revision=manifest.get("alembic_revision"),
            )
        )
    out.sort(key=lambda item: item.created_at, reverse=True)
    return out


def delete_backup(name: str) -> None:
    resolve(name).unlink(missing_ok=True)


def _alembic_revision() -> str | None:
    from sqlalchemy import text

    from app.db import engine

    try:
        with engine.connect() as conn:
            return conn.execute(text("select version_num from alembic_version")).scalar()
    except Exception:
        logger.debug("Alembic-revisie niet op te halen", exc_info=True)
        return None


# ----------------------------------------------------------------- maken


def create_backup(
    kind: BackupKind = "manual",
    *,
    include_media: bool = False,
    progress: Callable[[str, float], None] | None = None,
) -> BackupInfo:
    """Maak een backup en geef de gegevens van het resultaat terug."""
    report = progress or (lambda _m, _p: None)
    settings = get_settings()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"routeboek-{kind}-{stamp}.tar.gz"
    target = backup_dir() / name

    with tempfile.TemporaryDirectory(prefix="rb-backup-") as tmp:
        work = Path(tmp)
        dump = work / DUMP_NAME

        report("Database veiligstellen", 0.1)
        _run_pg_dump(dump)

        manifest = {
            "format": FORMAT_VERSION,
            "app": settings.app_name,
            "kind": kind,
            "created_at": datetime.now().astimezone().isoformat(),
            "has_media": include_media,
            "alembic_revision": _alembic_revision(),
        }
        (work / MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )

        report("Inpakken", 0.6)
        # Eerst naast het doel schrijven en pas daarna hernoemen: een afgebroken
        # backup laat zo nooit een half bestand achter dat eruitziet als een
        # geldige backup.
        partial = target.with_suffix(".part")
        with tarfile.open(partial, "w:gz") as tar:
            tar.add(work / MANIFEST_NAME, arcname=MANIFEST_NAME)
            tar.add(dump, arcname=DUMP_NAME)
            if include_media:
                report("Mediabestanden inpakken", 0.75)
                media = settings.media_dir
                if media.is_dir():
                    tar.add(media, arcname=MEDIA_DIR_NAME)
        partial.replace(target)

    report("Klaar", 1.0)
    stat = target.stat()
    logger.info(
        "Backup %s gemaakt (%.1f MB, media=%s)",
        name,
        stat.st_size / 1_048_576,
        include_media,
    )
    return BackupInfo(
        name=name,
        kind=kind,
        size_bytes=stat.st_size,
        created_at=datetime.now().astimezone(),
        has_media=include_media,
        alembic_revision=manifest.get("alembic_revision"),
    )


def _run_pg_dump(target: Path) -> None:
    cmd = [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        str(target),
        _dsn(),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump mislukte: {result.stderr.strip()[:500]}")


# -------------------------------------------------------------- retentie


def apply_retention() -> list[str]:
    """Ruim oude automatische backups op; handmatige blijven altijd staan."""
    removed: list[str] = []
    backups = list_backups()
    for kind, keep in (("auto", KEEP_AUTO), ("weekly", KEEP_WEEKLY)):
        same = [item for item in backups if item.kind == kind]
        for item in same[keep:]:
            try:
                delete_backup(item.name)
                removed.append(item.name)
            except (OSError, ValueError):
                logger.warning("Opruimen van %s mislukt", item.name, exc_info=True)
    if removed:
        logger.info("Oude backups opgeruimd: %s", ", ".join(removed))
    return removed


# ------------------------------------------------------------ terugzetten


def _safe_members(tar: tarfile.TarFile) -> list[tarfile.TarInfo]:
    """Weiger padtrucs voordat er ook maar iets wordt uitgepakt.

    `TarFile.extractall()` is standaard onveilig: een archief kan met absolute
    paden of `..` buiten de doelmap schrijven, en met symlinks naar elk pad op
    het systeem wijzen. Python past sinds 3.12 het `data`-filter toe, maar we
    controleren het hier expliciet — dit archief komt van buiten en dat filter
    mag niet de enige laag zijn.
    """
    safe: list[tarfile.TarInfo] = []
    for member in tar.getmembers():
        name = member.name
        if name.startswith("/") or ".." in Path(name).parts:
            raise ValueError(f"Onveilig pad in backup: {name}")
        if member.issym() or member.islnk():
            raise ValueError(f"Backup bevat een koppeling, dat mag niet: {name}")
        if not (member.isfile() or member.isdir()):
            raise ValueError(f"Onverwacht type in backup: {name}")
        safe.append(member)
    return safe


def inspect(path: Path) -> dict:
    """Lees en controleer het manifest; werpt een fout bij een vreemd bestand."""
    manifest = _read_manifest(path)
    if not manifest or "format" not in manifest:
        raise ValueError("Dit lijkt geen backup van het routeboek te zijn.")
    if int(manifest["format"]) > FORMAT_VERSION:
        raise ValueError(
            "Deze backup komt van een nieuwere versie van de applicatie."
        )
    return manifest


def restore(path: Path, progress: Callable[[str, float], None] | None = None) -> None:
    """Zet een backup terug en herstart daarna het proces.

    Het herstarten is opzettelijk: de applicatie houdt achtergrondthreads, een
    verbindingspool, een instellingencache en meerdere bestandscaches vast die na
    een volledige schemawissel niet meer kloppen. Vers opstarten is aantoonbaar
    schoon; alles ter plaatse verversen is dat niet. Docker start de container
    zelf weer op dankzij `restart: unless-stopped`.
    """
    report = progress or (lambda _m, _p: None)
    settings = get_settings()

    report("Backup controleren", 0.05)
    manifest = inspect(path)

    with tempfile.TemporaryDirectory(prefix="rb-restore-") as tmp:
        work = Path(tmp)
        report("Uitpakken", 0.15)
        with tarfile.open(path, "r:gz") as tar:
            members = _safe_members(tar)
            tar.extractall(work, members=members, filter="data")

        dump = work / DUMP_NAME
        if not dump.is_file():
            raise ValueError("De backup bevat geen database.")

        report("Verbindingen sluiten", 0.25)
        from app.db import engine

        engine.dispose()

        report("Database leegmaken", 0.3)
        _reset_schema()

        report("Database terugzetten", 0.45)
        _run_pg_restore(dump)

        if manifest.get("has_media") and (work / MEDIA_DIR_NAME).is_dir():
            report("Mediabestanden terugzetten", 0.75)
            _swap_media(work / MEDIA_DIR_NAME, settings.media_dir)

    report("Schema bijwerken", 0.9)
    _run_alembic_upgrade()

    logger.warning("Backup %s teruggezet; de applicatie wordt herstart.", path.name)
    report("Herstarten", 1.0)
    # Even wachten zodat de frontend het eindresultaat nog kan ophalen.
    threading.Timer(2.0, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()


def _reset_schema() -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(get_settings().database_url, poolclass=None)
    try:
        with engine.connect() as conn:
            conn.execute(text("drop schema if exists public cascade"))
            conn.execute(text("create schema public"))
            conn.commit()
    finally:
        engine.dispose()


def _run_pg_restore(dump: Path) -> None:
    cmd = [
        "pg_restore",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        _dsn(),
        str(dump),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    # pg_restore geeft ook bij onschuldige waarschuwingen een exitcode != 0;
    # alleen echte fouten mogen de restore laten mislukken.
    if result.returncode != 0 and "error" in result.stderr.lower():
        raise RuntimeError(f"pg_restore mislukte: {result.stderr.strip()[:500]}")
    if result.stderr.strip():
        logger.info("pg_restore meldde: %s", result.stderr.strip()[:500])


def _run_alembic_upgrade() -> None:
    """Werk een oudere backup bij naar het huidige schema."""
    result = subprocess.run(
        ["alembic", "upgrade", "head"], capture_output=True, text=True, cwd="/app"
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic upgrade mislukte: {result.stderr.strip()[:500]}")


def _swap_media(source: Path, target: Path) -> None:
    """Vervang de mediamap, met de oude als vangnet tot het gelukt is."""
    backup_old = target.with_name(target.name + ".oud")
    shutil.rmtree(backup_old, ignore_errors=True)
    if target.exists():
        target.rename(backup_old)
    try:
        shutil.move(str(source), str(target))
    except Exception:
        if backup_old.exists():
            shutil.rmtree(target, ignore_errors=True)
            backup_old.rename(target)
        raise
    shutil.rmtree(backup_old, ignore_errors=True)


# ------------------------------------------------------------- taakbeheer


@dataclass(slots=True)
class BackupJob:
    """Voortgang van een lopende backup of restore."""

    action: str
    state: str = "running"
    message: str = ""
    progress: float = 0.0
    error: str | None = None
    result: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now().astimezone())


_job_lock = threading.Lock()
_job: BackupJob | None = None


def current_job() -> BackupJob | None:
    return _job


def _start(action: str, work: Callable[[BackupJob], None]) -> BackupJob:
    global _job
    with _job_lock:
        if _job is not None and _job.state == "running":
            raise RuntimeError("Er loopt al een backuptaak.")
        job = BackupJob(action=action)
        _job = job

    def run() -> None:
        try:
            work(job)
            job.state = "done"
            job.progress = 1.0
        except Exception as exc:
            logger.exception("Backuptaak '%s' mislukt", action)
            job.state = "error"
            job.error = str(exc)

    threading.Thread(target=run, name=f"backup-{action}", daemon=True).start()
    return job


def start_backup(kind: BackupKind = "manual", *, include_media: bool = False) -> BackupJob:
    def work(job: BackupJob) -> None:
        def report(message: str, value: float) -> None:
            job.message = message
            job.progress = value

        info = create_backup(kind, include_media=include_media, progress=report)
        job.result = info.name
        apply_retention()

    return _start("backup", work)


def start_restore(name: str) -> BackupJob:
    path = resolve(name)
    if not path.is_file():
        raise FileNotFoundError("Deze backup bestaat niet.")
    # Controleer het manifest voordat de taak start, zodat een onbruikbaar
    # bestand een nette foutmelding geeft in plaats van een mislukte taak.
    inspect(path)

    def work(job: BackupJob) -> None:
        def report(message: str, value: float) -> None:
            job.message = message
            job.progress = value

        restore(path, report)
        job.result = name

    return _start("restore", work)


# ---------------------------------------------------------------- planning

_last_run_date: date | None = None


def _tick() -> None:
    """Maak rond 01:00 een databasebackup; op zondag ook een weekkopie."""
    global _last_run_date
    now = datetime.now()
    if now.hour != BACKUP_HOUR:
        return
    if _last_run_date == now.date():
        return
    _last_run_date = now.date()

    try:
        create_backup("auto")
        # isoweekday 7 is zondag: de nacht van zaterdag op zondag.
        if now.isoweekday() == 7:
            create_backup("weekly")
        apply_retention()
    except Exception:
        logger.exception("Automatische backup mislukt")


def start_backup_loop() -> None:
    """Achtergrondlus voor de nachtelijke backup.

    Zelfde patroon als `services/notices.py` en `services/route_ratings.py`: elke
    minuut kijken of het tijd is, met een datumgrendel zodat een herstart rond
    01:00 geen tweede backup oplevert.
    """

    def loop() -> None:
        while True:
            try:
                _tick()
            except Exception:
                logger.exception("Backuplus struikelde")
            time.sleep(60)

    threading.Thread(target=loop, name="backup-scheduler", daemon=True).start()
    logger.info("Nachtelijke backup actief (%02d:00).", BACKUP_HOUR)
