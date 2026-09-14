"""Lezen en schrijven van de instellingen in de tabel `app_settings`.

Losse module en niet onder `services/`, omdat `app.config` deze lazy importeert
terwijl de servicemap zelf juist `app.config` gebruikt. Zo blijft de
importvolgorde eenvoudig.

Waarden staan altijd als tekst in de database, precies zoals een
omgevingsvariabele. De omzetting naar int/bool/float laten we aan pydantic over
(`Settings(**overrides)`), zodat er maar één validatiepad bestaat.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import (
    RUNTIME_SETTING_KEYS,
    SECRET_SETTING_KEYS,
    SETUP_COMPLETED_KEY,
    Settings,
    refresh_settings,
)

logger = logging.getLogger(__name__)


def _as_text(value: Any) -> str | None:
    """Zet een waarde om naar de tekstvorm die ook in een .env zou staan."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def load_overrides() -> dict[str, str]:
    """Alle instelbare waarden uit de database.

    Gebruikt een eigen sessie omdat dit vanuit `get_settings()` wordt aangeroepen,
    buiten elk verzoek om. Sleutels die niet (meer) in de whitelist staan worden
    genegeerd, zodat een oude rij nooit een veld kan zetten dat inmiddels
    afgeschermd is.
    """
    from app.db import SessionLocal
    from app.models import AppSetting

    with SessionLocal() as db:
        rows = db.execute(select(AppSetting.key, AppSetting.value)).all()
    return {
        key: value
        for key, value in rows
        if key in RUNTIME_SETTING_KEYS and value is not None
    }


def save_overrides(
    db: Session,
    values: dict[str, Any],
    *,
    clear: list[str] | None = None,
    actor_id: int | None = None,
) -> None:
    """Sla instellingen op en laat de volgende `get_settings()` ze oppikken.

    Sleutels buiten `RUNTIME_SETTING_KEYS` worden geweigerd. Dat is de
    belangrijkste controle van deze module: zonder die regel zou een beheerder
    via de API bijvoorbeeld `database_url` of `secret_key` kunnen overschrijven.
    """
    from app.models import AppSetting

    unknown = sorted((set(values) | set(clear or [])) - RUNTIME_SETTING_KEYS)
    if unknown:
        raise ValueError(f"Onbekende of afgeschermde instelling: {', '.join(unknown)}")

    for key in clear or []:
        row = db.get(AppSetting, key)
        if row is not None:
            db.delete(row)

    for key, value in values.items():
        row = db.get(AppSetting, key)
        text = _as_text(value)
        if row is None:
            db.add(AppSetting(key=key, value=text, updated_by_id=actor_id))
        else:
            row.value = text
            row.updated_by_id = actor_id
            row.updated_at = datetime.now().astimezone()
    db.commit()
    refresh_settings()


def current_values() -> dict[str, Any]:
    """De actuele waarde van elk instelbaar veld, geheimen als `None`."""
    from app.config import get_settings

    settings = get_settings()
    out: dict[str, Any] = {}
    for key in sorted(RUNTIME_SETTING_KEYS):
        out[key] = None if key in SECRET_SETTING_KEYS else getattr(settings, key, None)
    return out


def secret_flags() -> dict[str, bool]:
    """Per geheim veld of het gevuld is; de waarde zelf verlaat de server nooit."""
    from app.config import get_settings

    settings = get_settings()
    return {key: bool(getattr(settings, key, "")) for key in sorted(SECRET_SETTING_KEYS)}


#: Velden die bewust niet instelbaar zijn, met de reden. Ze worden wél getoond op
#: de beheerpagina, zodat zichtbaar is wat er geldt en waarom je het daar niet
#: kunt wijzigen. De toelichting bij RUNTIME_SETTING_KEYS legt de keuzes uit.
READONLY_REASONS: dict[str, str] = {
    "database_url": "Nodig vóórdat de database gelezen kan worden.",
    "data_dir": "Pad binnen de container.",
    "port": "Wordt bij het opstarten gebonden.",
    "log_level": "Wordt bij het opstarten toegepast.",
    "cookie_secure": "Hangt af van de deploymethode (TLS via de reverse proxy).",
    "secret_key": "Blijft buiten de database, zodat een backup geen sessies kan vervalsen.",
    "nl_gpx_url": "Wordt server-side opgehaald; instelbaar maken zou verzoeken naar interne adressen mogelijk maken.",
    "admin_email": "Bootstrapveld; beheerders regel je via Gebruikers.",
}


def readonly_values() -> dict[str, str]:
    """De actuele waarde van de niet-instelbare velden, geheimen gemaskeerd."""
    from app.config import get_settings

    settings = get_settings()
    out: dict[str, str] = {}
    for key in READONLY_REASONS:
        value = getattr(settings, key, None)
        if key in ("secret_key", "database_url"):
            value = "ingesteld" if value else "niet ingesteld"
        out[key] = str(value)
    return out


def is_setup_completed(db: Session) -> bool:
    from app.models import AppSetting

    row = db.get(AppSetting, SETUP_COMPLETED_KEY)
    return bool(row and row.value == "true")


def mark_setup_completed(db: Session, *, actor_id: int | None = None) -> None:
    """Grendel de setup-wizard, blijvend.

    Deze vlag staat los van "zijn er gebruikers": zou een beheerder later per
    ongeluk alle accounts verwijderen, dan heropent de wizard daardoor niet.
    """
    from app.models import AppSetting

    row = db.get(AppSetting, SETUP_COMPLETED_KEY)
    if row is None:
        db.add(AppSetting(key=SETUP_COMPLETED_KEY, value="true", updated_by_id=actor_id))
    else:
        row.value = "true"
        row.updated_by_id = actor_id


def adopt_environment(db: Session) -> bool:
    """Neem bij een bestaande installatie de huidige .env over in de database.

    Draait eenmalig: staat `app_settings` leeg maar zijn er wél gebruikers, dan
    is dit een installatie van vóór deze functie. De actuele omgevingswaarden
    worden dan vastgelegd als overrides en de setup-wizard wordt gegrendeld. Voor
    de draaiende installatie verandert er dus niets, terwijl de beheerpagina
    meteen de echte waarden toont.

    Geeft terug of er iets is overgenomen.
    """
    from app.models import AppSetting, User

    if db.execute(select(AppSetting.key).limit(1)).first() is not None:
        return False
    if db.execute(select(User.id).limit(1)).first() is None:
        # Verse installatie: de setup-wizard vult dit straks zelf.
        return False

    env = Settings()
    for key in sorted(RUNTIME_SETTING_KEYS):
        db.add(AppSetting(key=key, value=_as_text(getattr(env, key, None))))
    mark_setup_completed(db)
    db.commit()
    refresh_settings()
    logger.info(
        "Bestaande installatie: %d instellingen overgenomen uit de omgeving.",
        len(RUNTIME_SETTING_KEYS),
    )
    return True
