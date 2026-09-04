"""Telegram-account koppelen en de webhook waarmee de bot updates ontvangt.

`/api/telegram/webhook` is bewust het enige endpoint in deze router zonder
`current_user`: Telegram zelf kan onmogelijk onze sessiecookie meesturen.
In plaats daarvan wordt elk verzoek gecontroleerd op de geheime header die
alleen Telegram (na `setWebhook`) meestuurt. Zie ook beveiligingsregel 1 in
`.github/copilot-instructions.md`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import User
from app.schemas import Message, TelegramLinkOut, TelegramStatusOut
from app.security import constant_time_equals
from app.services import telegram as telegram_service

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


@router.get("/status", response_model=TelegramStatusOut)
def telegram_status(user: User = Depends(current_user)) -> TelegramStatusOut:
    settings = get_settings()
    return TelegramStatusOut(
        linked=user.telegram_chat_id is not None,
        username=user.telegram_username,
        linked_at=user.telegram_linked_at,
        enabled=settings.telegram_enabled,
        bot_username=settings.telegram_bot_username if settings.telegram_enabled else None,
        channel_invite_link=settings.telegram_channel_invite_link or None,
    )


@router.post("/link", response_model=TelegramLinkOut)
def create_link(
    db: Session = Depends(get_db), user: User = Depends(current_user)
) -> TelegramLinkOut:
    settings = get_settings()
    if not settings.telegram_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Telegram is nog niet ingesteld voor deze club.",
        )
    token = telegram_service.create_link_token(db, user)
    return TelegramLinkOut(
        link=telegram_service.link_deep_url(token),
        expires_in_minutes=settings.telegram_link_token_ttl_minutes,
    )


@router.post("/unlink", response_model=Message)
def unlink(
    db: Session = Depends(get_db), user: User = Depends(current_user)
) -> Message:
    user.telegram_chat_id = None
    user.telegram_username = None
    user.telegram_linked_at = None
    db.commit()
    return Message(detail="Telegram-koppeling verwijderd.")


@router.post("/webhook", include_in_schema=False)
async def webhook(request: Request, db: Session = Depends(get_db)) -> dict[str, bool]:
    settings = get_settings()
    header = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not settings.telegram_webhook_secret or not constant_time_equals(
        header, settings.telegram_webhook_secret
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ongeldige afzender.")
    update = await request.json()
    # Altijd 200 teruggeven: Telegram blijft anders hetzelfde update opnieuw
    # aanbieden. Fouten in de afhandeling zelf worden gelogd, niet getoond.
    try:
        telegram_service.handle_webhook_update(db, update)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("telegram: webhook-verwerking mislukt")
    return {"ok": True}
