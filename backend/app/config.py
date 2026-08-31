"""Applicatie-instellingen, gelezen uit omgevingsvariabelen of een .env bestand."""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # -- Waterpunten (overgenomen uit de gpx-waterpunten app) -------------
    nl_gpx_url: str = (
        "https://drinkwaterpunten.nl/assets/gpx/publieke_drinkwaterpunten_nl.gpx"
    )
    nl_cache_ttl_seconds: int = 86400
    nl_share_threshold: float = 0.8
    overpass_url: str = (
        "https://overpass-api.de/api/interpreter,"
        "https://overpass.private.coffee/api/interpreter"
    )
    overpass_timeout: int = 60
    default_radius_m: int = 250
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
