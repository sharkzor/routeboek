"""Wachtwoorden, tokens, sessies en CSRF."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import EmailToken, TokenPurpose, User, UserSession, utcnow

SESSION_COOKIE = "rb_session"
CSRF_COOKIE = "rb_csrf"
CSRF_HEADER = "X-CSRF-Token"

# Bewuste parameterkeuze: ~64 MB geheugen en 3 iteraties is de OWASP-aanbeveling
# voor Argon2id en blijft ruim onder een halve seconde op deze server.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)

# Hash van een dummy-wachtwoord. Wordt geverifieerd als een e-mailadres niet
# bestaat, zodat inloggen altijd evenveel tijd kost en accounts niet lekken.
_DUMMY_HASH = _hasher.hash("routeboek-dummy-wachtwoord")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        _hasher.verify(password_hash or _DUMMY_HASH, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def normalize_email(email: str) -> str:
    return email.strip().lower()


# --------------------------------------------------------------------- sessies


def create_session(
    db: Session, user: User, user_agent: str | None, ip: str | None
) -> tuple[UserSession, str]:
    """Maak een sessie aan en geef het ruwe token terug voor in de cookie."""
    settings = get_settings()
    raw = new_token()
    session = UserSession(
        user_id=user.id,
        token_hash=token_hash(raw),
        csrf_token=secrets.token_urlsafe(32),
        user_agent=(user_agent or "")[:255] or None,
        ip_address=(ip or "")[:64] or None,
        expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session, raw


def load_session(db: Session, raw_token: str | None) -> UserSession | None:
    """Zoek een geldige sessie bij het cookietoken en werk `last_seen_at` bij."""
    if not raw_token:
        return None
    settings = get_settings()
    session = db.scalar(
        select(UserSession).where(UserSession.token_hash == token_hash(raw_token))
    )
    if session is None or session.revoked_at is not None:
        return None

    now = utcnow()
    if _aware(session.expires_at) <= now:
        return None
    idle_limit = timedelta(hours=settings.session_idle_timeout_hours)
    if now - _aware(session.last_seen_at) > idle_limit:
        session.revoked_at = now
        db.commit()
        return None

    # Niet bij elk request schrijven; eens per vijf minuten is genoeg.
    if now - _aware(session.last_seen_at) > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()
    return session


def revoke_session(db: Session, session: UserSession) -> None:
    session.revoked_at = utcnow()
    db.commit()


def revoke_all_sessions(db: Session, user_id: int) -> None:
    """Gebruikt na een wachtwoordwijziging of blokkade."""
    now = utcnow()
    for session in db.scalars(
        select(UserSession).where(
            UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
        )
    ):
        session.revoked_at = now
    db.commit()


# ---------------------------------------------------------------- e-mailtokens


def issue_email_token(
    db: Session,
    user: User,
    purpose: TokenPurpose,
    ttl: timedelta,
    invalidate_existing: bool = True,
) -> str:
    """Maak een eenmalig token.

    Standaard trekt dit eerdere ongebruikte tokens voor hetzelfde doel in
    (belangrijk bij wachtwoordherstel: een oude reset-link mag na een nieuwe
    aanvraag niet blijven werken). Voor e-mailbevestiging zetten we
    `invalidate_existing=False`: als iemand de mail meerdere keren opnieuw
    aanvraagt (bv. omdat de eerste mail traag aankomt), blijven alle
    verstuurde links geldig totdat er eentje gebruikt wordt. Anders klikt de
    gebruiker op een 'oude' mail uit hun postvak en krijgt onterecht
    'ongeldige link' te zien, terwijl de link an sich prima werkte.
    """
    now = utcnow()
    if invalidate_existing:
        for old in db.scalars(
            select(EmailToken).where(
                EmailToken.user_id == user.id,
                EmailToken.purpose == purpose,
                EmailToken.used_at.is_(None),
            )
        ):
            old.used_at = now

    raw = new_token()
    db.add(
        EmailToken(
            user_id=user.id,
            token_hash=token_hash(raw),
            purpose=purpose,
            expires_at=now + ttl,
        )
    )
    db.commit()
    return raw


def consume_email_token(
    db: Session, raw: str, purpose: TokenPurpose
) -> EmailToken | None:
    """Verzilver een token; geeft None als het ongeldig, gebruikt of verlopen is."""
    token = db.scalar(
        select(EmailToken).where(
            EmailToken.token_hash == token_hash(raw), EmailToken.purpose == purpose
        )
    )
    if token is None or token.used_at is not None:
        return None
    if _aware(token.expires_at) <= utcnow():
        return None
    token.used_at = utcnow()
    db.commit()
    return token


# ------------------------------------------------------------------- lockout


def is_locked(user: User) -> bool:
    return user.locked_until is not None and _aware(user.locked_until) > utcnow()


def register_failed_login(db: Session, user: User) -> None:
    settings = get_settings()
    user.failed_logins += 1
    if user.failed_logins >= settings.max_login_attempts:
        user.locked_until = utcnow() + timedelta(minutes=settings.lockout_minutes)
        user.failed_logins = 0
    db.commit()


def reset_failed_logins(db: Session, user: User) -> None:
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    db.commit()


def _aware(value: datetime) -> datetime:
    """Postgres levert tijdzone-bewuste waarden; SQLite-achtige fallback voor tests."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
