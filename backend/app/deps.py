"""FastAPI-dependencies voor authenticatie en autorisatie.

Elk endpoint buiten `/api/auth/*`, `/api/health` en `/api/telegram/webhook`
hoort `current_user` of `current_admin` te gebruiken. Dat laatste endpoint
ontvangt verzoeken van Telegram zelf (geen sessiecookie mogelijk) en
controleert in plaats daarvan een geheime header; zie `routers/telegram.py`.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User, UserSession
from app.security import (
    CSRF_HEADER,
    SESSION_COOKIE,
    constant_time_equals,
    load_session,
)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def get_session(request: Request, db: Session = Depends(get_db)) -> UserSession:
    session = load_session(db, request.cookies.get(SESSION_COOKIE))
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Je bent niet (meer) ingelogd.",
        )

    # Double-submit CSRF: bij muterende requests moet de header overeenkomen met
    # het token dat bij de sessie hoort.
    if request.method in UNSAFE_METHODS:
        header = request.headers.get(CSRF_HEADER, "")
        if not header or not constant_time_equals(header, session.csrf_token):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Ongeldig of ontbrekend CSRF-token. Herlaad de pagina.",
            )
    return session


def current_user(
    session: UserSession = Depends(get_session), db: Session = Depends(get_db)
) -> User:
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dit account is geblokkeerd.",
        )
    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bevestig eerst je e-mailadres.",
        )
    return user


def current_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hiervoor heb je beheerdersrechten nodig.",
        )
    return user


def client_ip(request: Request) -> str | None:
    """IP van de bezoeker; uvicorn draait met --proxy-headers achter nginxproxy."""
    return request.client.host if request.client else None


def set_auth_cookies(response, raw_token: str, csrf_token: str) -> None:
    settings = get_settings()
    max_age = settings.session_ttl_hours * 3600
    response.set_cookie(
        SESSION_COOKIE,
        raw_token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    # Bewust niet HttpOnly: de frontend moet dit token in de header kunnen zetten.
    response.set_cookie(
        "rb_csrf",
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response) -> None:
    for name in (SESSION_COOKIE, "rb_csrf"):
        response.delete_cookie(name, path="/")
