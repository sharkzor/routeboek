"""Registratie, inloggen, e-mailverificatie en wachtwoordherstel.

Deze router is als enige (samen met /api/health) publiek bereikbaar. Alle
antwoorden zijn bewust generiek geformuleerd, zodat een buitenstaander niet kan
afleiden welke e-mailadressen een account hebben.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import (
    clear_auth_cookies,
    client_ip,
    current_user,
    get_session,
    set_auth_cookies,
)
from app.mail import send_password_reset_mail, send_verification_mail
from app.models import TokenPurpose, User, UserSession, utcnow
from app.schemas import (
    ChangePasswordIn,
    ForgotPasswordIn,
    LoginIn,
    Message,
    RegisterIn,
    ResetPasswordIn,
    SessionOut,
    UserOut,
    VerifyEmailIn,
)
from app.security import (
    consume_email_token,
    create_session,
    hash_password,
    is_locked,
    issue_email_token,
    needs_rehash,
    normalize_email,
    register_failed_login,
    reset_failed_logins,
    revoke_all_sessions,
    revoke_session,
    verify_password,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

GENERIC_REGISTER = (
    "Als dit e-mailadres nog niet in gebruik was, is er een bevestigingsmail "
    "verstuurd. Kijk ook even in je spamfolder."
)
GENERIC_FORGOT = (
    "Als dit e-mailadres bij ons bekend is, is er een e-mail verstuurd om een "
    "nieuw wachtwoord in te stellen."
)
INVALID_LOGIN = "E-mailadres of wachtwoord klopt niet."


def _find_user(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == normalize_email(email)))


def _send_verification(background: BackgroundTasks, db: Session, user: User) -> None:
    settings = get_settings()
    raw = issue_email_token(
        db, user, TokenPurpose.verify_email, timedelta(hours=settings.verify_token_ttl_hours)
    )
    url = f"{settings.base_url.rstrip('/')}/verifieren?token={raw}"
    background.add_task(
        send_verification_mail,
        user.email,
        user.display_name,
        url,
        settings.verify_token_ttl_hours,
    )


@router.post("/register", response_model=Message, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterIn, background: BackgroundTasks, db: Session = Depends(get_db)
) -> Message:
    email = normalize_email(payload.email)
    existing = _find_user(db, email)

    if existing is not None:
        # Bestaand maar nog niet bevestigd account: stuur de mail opnieuw.
        # Bestaand en wel bevestigd: doe niets, maar antwoord hetzelfde.
        if not existing.is_verified and existing.is_active:
            _send_verification(background, db, existing)
        return Message(detail=GENERIC_REGISTER)

    user = User(
        email=email,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Race met een gelijktijdige registratie; antwoord blijft gelijk.
        db.rollback()
        return Message(detail=GENERIC_REGISTER)
    db.refresh(user)

    _promote_first_admin(db, user)
    _send_verification(background, db, user)
    logger.info("Nieuwe registratie: %s", user.email)
    return Message(detail=GENERIC_REGISTER)


def _promote_first_admin(db: Session, user: User) -> None:
    if user.email == normalize_email(get_settings().admin_email):
        user.is_admin = True
        db.commit()


@router.post("/verify", response_model=Message)
def verify_email(payload: VerifyEmailIn, db: Session = Depends(get_db)) -> Message:
    token = consume_email_token(db, payload.token, TokenPurpose.verify_email)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deze bevestigingslink is ongeldig of verlopen. Vraag een nieuwe aan.",
        )
    user = db.get(User, token.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Onbekend account.")
    if not user.is_verified:
        user.email_verified_at = utcnow()
        db.commit()
    return Message(detail="Je account is bevestigd. Je kunt nu inloggen.")


@router.post("/resend-verification", response_model=Message)
def resend_verification(
    payload: ForgotPasswordIn, background: BackgroundTasks, db: Session = Depends(get_db)
) -> Message:
    user = _find_user(db, payload.email)
    if user is not None and user.is_active and not user.is_verified:
        _send_verification(background, db, user)
    return Message(detail=GENERIC_REGISTER)


@router.post("/login", response_model=SessionOut)
def login(
    payload: LoginIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SessionOut:
    user = _find_user(db, payload.email)

    # Eerst de lockout: anders kan een aanvaller ongelimiteerd blijven raden,
    # omdat een geblokkeerd account nog steeds elke poging zou verwerken.
    if user is not None and is_locked(user):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Te veel mislukte pogingen. Probeer het over "
                f"{get_settings().lockout_minutes} minuten opnieuw."
            ),
        )

    # Ook bij een onbekend account het wachtwoord "verifieren", zodat de
    # responstijd niets verraadt.
    password_ok = verify_password(user.password_hash if user else None, payload.password)

    if user is None or not password_ok:
        if user is not None:
            register_failed_login(db, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_LOGIN)

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Dit account is geblokkeerd."
        )
    if not user.is_verified:
        _send_verification(background, db, user)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Je account is nog niet bevestigd. We hebben een nieuwe "
                "bevestigingsmail gestuurd."
            ),
        )

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    reset_failed_logins(db, user)

    session, raw = create_session(
        db, user, request.headers.get("user-agent"), client_ip(request)
    )
    set_auth_cookies(response, raw, session.csrf_token)
    return SessionOut(user=UserOut.model_validate(user), csrf_token=session.csrf_token)


@router.post("/logout", response_model=Message)
def logout(
    response: Response,
    session: UserSession = Depends(get_session),
    db: Session = Depends(get_db),
) -> Message:
    revoke_session(db, session)
    clear_auth_cookies(response)
    return Message(detail="Je bent uitgelogd.")


@router.get("/me", response_model=SessionOut)
def me(
    session: UserSession = Depends(get_session), db: Session = Depends(get_db)
) -> SessionOut:
    user = db.get(User, session.user_id)
    if user is None or not user.is_active or not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Je bent niet (meer) ingelogd."
        )
    return SessionOut(user=UserOut.model_validate(user), csrf_token=session.csrf_token)


@router.post("/forgot-password", response_model=Message)
def forgot_password(
    payload: ForgotPasswordIn, background: BackgroundTasks, db: Session = Depends(get_db)
) -> Message:
    settings = get_settings()
    user = _find_user(db, payload.email)
    if user is not None and user.is_active:
        raw = issue_email_token(
            db,
            user,
            TokenPurpose.reset_password,
            timedelta(minutes=settings.reset_token_ttl_minutes),
        )
        url = f"{settings.base_url.rstrip('/')}/wachtwoord-herstellen?token={raw}"
        background.add_task(
            send_password_reset_mail,
            user.email,
            user.display_name,
            url,
            settings.reset_token_ttl_minutes,
        )
    return Message(detail=GENERIC_FORGOT)


@router.post("/reset-password", response_model=Message)
def reset_password(payload: ResetPasswordIn, db: Session = Depends(get_db)) -> Message:
    token = consume_email_token(db, payload.token, TokenPurpose.reset_password)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deze herstellink is ongeldig of verlopen. Vraag een nieuwe aan.",
        )
    user = db.get(User, token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Onbekend account.")

    user.password_hash = hash_password(payload.password)
    user.failed_logins = 0
    user.locked_until = None
    # Een reset bevestigt meteen het e-mailadres: de mail is immers aangekomen.
    if not user.is_verified:
        user.email_verified_at = utcnow()
    db.commit()

    # Alle bestaande sessies intrekken; mogelijk was het account gekaapt.
    revoke_all_sessions(db, user.id)
    return Message(detail="Je wachtwoord is gewijzigd. Je kunt nu inloggen.")


@router.post("/change-password", response_model=Message)
def change_password(
    payload: ChangePasswordIn,
    response: Response,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Message:
    if not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Je huidige wachtwoord klopt niet.",
        )
    user.password_hash = hash_password(payload.new_password)
    db.commit()

    revoke_all_sessions(db, user.id)
    session, raw = create_session(
        db, user, request.headers.get("user-agent"), client_ip(request)
    )
    set_auth_cookies(response, raw, session.csrf_token)
    return Message(detail="Je wachtwoord is gewijzigd.")
