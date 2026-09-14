"""Applicatie-instellingen.

Instellingen komen uit drie lagen, van laag naar hoog in voorrang:

1. de standaardwaarden hieronder;
2. omgevingsvariabelen en `.env`;
3. de tabel `app_settings` in de database, voor de velden in
   `RUNTIME_SETTING_KEYS`.

Laag 3 maakt de applicatie tijdens het draaien instelbaar via de beheerpagina,
zonder herstart. Niet elk veld mag daar in: zie de toelichting bij
`RUNTIME_SETTING_KEYS`.
"""

from __future__ import annotations

import logging
import secrets
import threading
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # -- Algemeen ---------------------------------------------------------
    app_name: str = "Routeboek Maximus Stampers"
    club_name: str = "Maximus Stampers"
    base_url: str = "https://routeboek.unencrypted.nl"
    port: int = 8083
    log_level: str = "INFO"
    data_dir: Path = Path("/app/data")

    # -- Database ---------------------------------------------------------
    database_url: str = "postgresql+psycopg://routeboek:routeboek@db:5432/routeboek"

    # -- Beveiliging ------------------------------------------------------
    secret_key: str = ""
    cookie_secure: bool = True
    session_ttl_hours: int = 24 * 14
    session_idle_timeout_hours: int = 24 * 7
    verify_token_ttl_hours: int = 48
    reset_token_ttl_minutes: int = 60
    max_login_attempts: int = 8
    login_window_minutes: int = 15
    lockout_minutes: int = 15

    # Eerste beheerder; krijgt bij het opstarten automatisch adminrechten.
    admin_email: str = "r.vloothuis@gmail.com"
    admin_name: str = "Robert Vloothuis"

    # -- E-mail -----------------------------------------------------------
    smtp_host: str = "smtp.ziggo.nl"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    smtp_ssl: bool = False
    smtp_from: str = ""
    smtp_from_name: str = "Routeboek Maximus Stampers"
    smtp_timeout: int = 30
    mail_enabled: bool = True

    # -- Ritten -----------------------------------------------------------
    ride_min_participants: int = 4
    ride_max_participants: int = 12
    ride_default_participants: int = 10

    # -- Telegram -----------------------------------------------------------
    # Bot aangemaakt via @BotFather. Leeg laten schakelt de hele integratie
    # onopvallend uit: posten/koppelen faalt dan stil (gelogd), de rest van de
    # app blijft gewoon werken.
    telegram_bot_token: str = ""
    telegram_bot_username: str = "stampersrouteboek_bot"
    #: Chat-id van het kanaal waar nieuwe (niet-prive) ritten in gepost worden.
    telegram_channel_id: str = ""
    #: Publieke uitnodigingslink (bv. https://t.me/+... of https://t.me/naam)
    #: naar hetzelfde kanaal, alleen om aan leden te tonen op de infopagina.
    #: De chat-id hierboven is intern (voor de Bot-API) en niet klikbaar.
    telegram_channel_invite_link: str = ""
    #: Gecontroleerd op elk binnenkomend webhook-verzoek (header
    #: X-Telegram-Bot-Api-Secret-Token), zodat alleen Telegram zelf ons kan
    #: aanroepen op dit ene ongeauthenticeerde endpoint.
    telegram_webhook_secret: str = ""
    telegram_link_token_ttl_minutes: int = 10
    #: Hoe lang van tevoren de wegkapitein een Telegram-DM met de
    #: deelnemerslijst krijgt.
    telegram_reminder_minutes_before: int = 5

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token)

    # -- Waterpunten (overgenomen uit de gpx-waterpunten app) -------------
    # Alle routes van de club liggen in Nederland, dus is drinkwaterpunten.nl
    # de enige bron (geen OSM/Overpass-alternatief meer nodig).
    nl_gpx_url: str = (
        "https://drinkwaterpunten.nl/assets/gpx/publieke_drinkwaterpunten_nl.gpx"
    )
    nl_cache_ttl_seconds: int = 86400
    default_radius_m: int = 100
    dedupe_distance_m: float = 50.0
    gap_warning_km: float = 40.0
    waypoint_prefix: str = "💧 Water"
    waypoint_with_km: bool = True
    waypoint_sym: str = "Water Source"
    waypoint_type: str = "Water"
    # Nog niet gebruikt in de UI, maar de overgenomen GPX-schrijver verwacht ze.
    roadworks_prefix: str = "🚧 Werkzaamheden"
    roadworks_sym: str = "Danger Area"
    roadworks_type: str = "Roadworks"
    user_agent: str = "routeboek-stampers/1.0 (+https://routeboek.unencrypted.nl)"

    @field_validator("data_dir", mode="before")
    @classmethod
    def _as_path(cls, value: object) -> Path:
        return Path(str(value))

    # -- Afgeleide paden --------------------------------------------------

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def mail_from(self) -> str:
        return self.smtp_from or self.smtp_user

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.media_dir, self.cache_dir, self.tmp_dir):
            path.mkdir(parents=True, exist_ok=True)
        for sub in ("gpx", "tcx", "maps"):
            (self.media_dir / sub).mkdir(parents=True, exist_ok=True)

    def resolve_secret_key(self) -> str:
        """Gebruik de ingestelde sleutel, of genereer er eenmalig een in data_dir.

        Zo blijven bestaande sessies geldig na een herstart, ook als de beheerder
        geen SECRET_KEY heeft ingevuld.
        """
        if self.secret_key:
            return self.secret_key
        self.ensure_dirs()
        key_file = self.data_dir / "secret.key"
        if key_file.exists():
            value = key_file.read_text(encoding="utf-8").strip()
            if value:
                return value
        value = secrets.token_urlsafe(64)
        key_file.write_text(value, encoding="utf-8")
        key_file.chmod(0o600)
        return value


#: Velden die een beheerder tijdens het draaien mag aanpassen (tabel
#: `app_settings`). Bewust een whitelist en geen zwarte lijst: een nieuw veld in
#: `Settings` is standaard *niet* instelbaar, wat de veilige kant is.
#:
#: Hier staan met opzet NIET in:
#:
#: - `database_url` en `data_dir` — kip-ei: die zijn nodig vóórdat er een
#:   database is om instellingen uit te lezen.
#: - `port`, `log_level`, `cookie_secure` — eigenschappen van de container en de
#:   deploymethode. Ze worden bij het opstarten één keer toegepast, dus ze
#:   tijdens het draaien wijzigen wekt alleen de illusie dat er iets gebeurt.
#:   `cookie_secure` is bovendien gevaarlijk: één verkeerde klik zet de
#:   Secure-vlag van alle sessiecookies uit.
#: - `secret_key` — mag nooit in een databasebackup belanden; wie zo'n bestand
#:   heeft zou anders sessiecookies en herstel-tokens kunnen vervalsen.
#: - `nl_gpx_url` en `user_agent` — die URL wordt server-side opgehaald
#:   (`water/waterpoints_nl.py`). Instelbaar maken geeft een beheerder een
#:   SSRF-primitive richting interne adressen, bijvoorbeeld de
#:   metadata-endpoint 169.254.169.254 bij een cloudhoster. De bron verandert
#:   nooit, dus er is geen reden voor.
#: - `admin_email` / `admin_name` — bootstrapvelden, vervangen door de
#:   setup-wizard.
#: - `waypoint_*`, `roadworks_*`, `nl_cache_ttl_seconds` — interne details die
#:   een clubbeheerder nooit hoeft aan te raken. Weglaten houdt de
#:   instellingenpagina begrijpelijk.
RUNTIME_SETTING_KEYS: frozenset[str] = frozenset(
    {
        # Algemeen
        "app_name",
        "club_name",
        "base_url",
        # E-mail
        "mail_enabled",
        "smtp_host",
        "smtp_port",
        "smtp_user",
        "smtp_password",
        "smtp_starttls",
        "smtp_ssl",
        "smtp_from",
        "smtp_from_name",
        "smtp_timeout",
        # Telegram
        "telegram_bot_token",
        "telegram_bot_username",
        "telegram_channel_id",
        "telegram_channel_invite_link",
        "telegram_webhook_secret",
        "telegram_link_token_ttl_minutes",
        "telegram_reminder_minutes_before",
        # Ritten
        "ride_min_participants",
        "ride_max_participants",
        "ride_default_participants",
        # Sessies en lockout
        "session_ttl_hours",
        "session_idle_timeout_hours",
        "verify_token_ttl_hours",
        "reset_token_ttl_minutes",
        "max_login_attempts",
        "login_window_minutes",
        "lockout_minutes",
        # Waterpunten
        "default_radius_m",
        "dedupe_distance_m",
        "gap_warning_km",
    }
)

#: Instellingen die de API nooit teruggeeft; de beheerpagina ziet alleen of ze
#: gevuld zijn. Leeg laten bij het opslaan betekent "ongewijzigd".
SECRET_SETTING_KEYS: frozenset[str] = frozenset(
    {"smtp_password", "telegram_bot_token", "telegram_webhook_secret"}
)

#: Sleutel in `app_settings` die aangeeft dat de installatie is afgerond. Staat
#: los van de instellingen hierboven en hoort daarom niet in de whitelist.
SETUP_COMPLETED_KEY = "setup_completed"


# `db.py` roept get_settings() aan tijdens het importeren, en het ophalen van de
# overrides gebruikt db.py. Zonder deze vlag zou dat oneindig recursen; nu krijgt
# een aanroep tijdens het laden gewoon de omgevingsversie.
_loading = threading.local()

_cache_lock = threading.Lock()
_cached: Settings | None = None


def _env_settings() -> Settings:
    return Settings()


def get_settings() -> Settings:
    """De actuele instellingen: omgeving, met de databasewaarden eroverheen.

    Faalt de database (onbereikbaar, of de tabel `app_settings` bestaat nog niet
    omdat de migratie nog moet draaien), dan gelden alleen de omgevingswaarden.
    Dat resultaat wordt bewust **niet** gecachet, zodat een volgende aanroep het
    opnieuw probeert zodra de database er weer is.
    """
    global _cached
    if getattr(_loading, "busy", False):
        # Aangeroepen vanuit het laden van de overrides zelf.
        return _env_settings()
    if _cached is not None:
        return _cached
    with _cache_lock:
        if _cached is not None:
            return _cached
        _loading.busy = True
        try:
            from app.settings_store import load_overrides

            overrides = load_overrides()
        except Exception:
            logger.debug("Instellingen uit de database niet beschikbaar", exc_info=True)
            return _env_settings()
        finally:
            _loading.busy = False
        # Expliciete kwargs winnen van de omgeving; pydantic-settings vult de
        # rest aan uit .env en doet meteen de typeomzetting en validatie.
        _cached = Settings(**overrides) if overrides else _env_settings()
        return _cached


def refresh_settings() -> None:
    """Vergeet de gecachete instellingen; de volgende aanroep leest opnieuw."""
    global _cached
    with _cache_lock:
        _cached = None
