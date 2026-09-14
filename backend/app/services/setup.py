"""Eerste installatie: grendels, setup-token en het aanmaken van de beheerder.

De setup-wizard is het enige deel van de applicatie dat zonder inloggen iets aan
de database mag veranderen. Dat is onvermijdelijk — bij een lege database bestaat
er nog geen account om mee in te loggen — en daarom liggen er drie
*onafhankelijke* grendels op:

1. er mag nog geen enkele gebruiker bestaan;
2. de vlag `setup_completed` mag niet in `app_settings` staan;
3. het verzoek moet het juiste setup-token meesturen (header `X-Setup-Token`).

Grendel 1 en 2 staan er allebei omdat ze verschillende dingen overleven: zou een
beheerder ooit alle accounts verwijderen, dan heropent de wizard niet, want de
vlag staat er nog. En bij een verse installatie waar de vlag nog ontbreekt, houdt
grendel 1 hem dicht zodra het eerste account bestaat.

Grendel 3 dekt het venster daartussen af: een verse installatie die al publiek
bereikbaar is voordat de beheerder erbij is. Zonder token zou wie hem als eerste
vindt beheerder worden.

**Alles faalt dicht.** Kan de status niet bepaald worden (database weg, tabel
bestaat nog niet, time-out), dan is setup *niet* toegestaan. Een storing mag nooit
een installatiewizard openzetten op een draaiend systeem.
"""

from __future__ import annotations

import logging
import secrets
import threading
import time
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.security import constant_time_equals

logger = logging.getLogger(__name__)

TOKEN_FILE = "setup-token"

#: Zelfde orde van grootte als de login-lockout: raden is geen optie, maar een
#: vertypte beheerder hoeft niet minutenlang te wachten.
MAX_TOKEN_ATTEMPTS = 10
ATTEMPT_WINDOW_SECONDS = 300

_lock = threading.Lock()
_attempts: list[float] = []


def _token_path() -> Path:
    return get_settings().data_dir / TOKEN_FILE


def setup_required(db: Session) -> bool:
    """Of de installatiewizard nog doorlopen mag worden. Faalt dicht."""
    from app.models import User
    from app.settings_store import is_setup_completed

    try:
        if is_setup_completed(db):
            return False
        return db.execute(select(User.id).limit(1)).first() is None
    except Exception:
        logger.exception("Setup-status onbepaalbaar; wizard blijft dicht")
        return False


def current_token() -> str | None:
    """Het geldende setup-token, of None als er geen installatie open staat.

    Volgorde: de omgevingsvariabele `SETUP_TOKEN` wint, anders het eerder
    gegenereerde bestand. De omgevingsvariabele is bedoeld voor hosters en Azure,
    waar containerlogs lastig te lezen zijn maar een omgevingsvariabele zo gezet
    is; je kiest het token dan vooraf zelf.
    """
    import os

    from_env = os.getenv("SETUP_TOKEN", "").strip()
    if from_env:
        return from_env
    path = _token_path()
    try:
        if path.is_file():
            return path.read_text(encoding="utf-8").strip() or None
    except OSError:
        logger.warning("Setup-token niet leesbaar uit %s", path)
    return None


def ensure_token() -> str | None:
    """Maak bij een openstaande installatie een token aan en log het opvallend.

    Wordt aangeroepen bij het opstarten. Staat `SETUP_TOKEN` in de omgeving, dan
    genereert dit niets — die waarde geldt dan.
    """
    import os

    if os.getenv("SETUP_TOKEN", "").strip():
        logger.info("Setup-token overgenomen uit de omgevingsvariabele SETUP_TOKEN.")
        return os.environ["SETUP_TOKEN"].strip()

    existing = current_token()
    if existing:
        _log_token(existing)
        return existing

    token = secrets.token_urlsafe(24)
    path = _token_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")
        path.chmod(0o600)
    except OSError:
        logger.exception("Setup-token kon niet worden opgeslagen in %s", path)
        return None
    _log_token(token)
    return token


def _log_token(token: str) -> None:
    logger.warning(
        "\n%s\n SETUP-TOKEN: %s\n Vul dit token in op %s/setup om de installatie"
        " te starten.\n%s",
        "=" * 70,
        token,
        get_settings().base_url.rstrip("/"),
        "=" * 70,
    )


def clear_token() -> None:
    """Ruim het tokenbestand op zodra de installatie is afgerond."""
    try:
        _token_path().unlink(missing_ok=True)
    except OSError:
        logger.warning("Setup-token kon niet worden verwijderd")


def token_valid(supplied: str | None) -> bool:
    """Controleer het aangeleverde token, met een rem op raden."""
    if not supplied:
        return False
    expected = current_token()
    if not expected:
        # Geen token beschikbaar betekent dicht, niet open.
        return False
    if not _allow_attempt():
        logger.warning("Te veel setup-tokenpogingen; tijdelijk geweigerd")
        return False
    ok = constant_time_equals(supplied, expected)
    if ok:
        with _lock:
            _attempts.clear()
    return ok


def _allow_attempt() -> bool:
    now = time.monotonic()
    with _lock:
        cutoff = now - ATTEMPT_WINDOW_SECONDS
        _attempts[:] = [stamp for stamp in _attempts if stamp > cutoff]
        if len(_attempts) >= MAX_TOKEN_ATTEMPTS:
            return False
        _attempts.append(now)
        return True
