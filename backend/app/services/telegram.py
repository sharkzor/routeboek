"""Telegram-integratie: bot-API, webhook-afhandeling en de deelnemersreminder.

Bewust met kale HTTP-calls (`requests`, al een dependency) in plaats van een
Telegram-SDK: de bot doet maar drie dingen (bericht sturen, bericht bewerken,
`/start`-koppeling verwerken) en dat is met een paar `requests.post`-calls
sneller gebouwd en makkelijker te doorgronden dan een hele library erbij te
halen. Zelfde afweging als bij `mail.py` (kale `smtplib` i.p.v. een
mail-library).

Alles hier is bewust *best-effort*: een hapering bij Telegram mag nooit een
rit onbruikbaar maken. Fouten worden gelogd, nooit doorgegeven aan de
eindgebruiker als een 500'er.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.db import SessionLocal
from app.models import Ride, RideParticipant, RideType, TokenPurpose, User, utcnow
from app.security import consume_email_token, issue_email_token

logger = logging.getLogger(__name__)

_API_TIMEOUT = 10

_RIDE_TYPE_LABELS: dict[RideType, str] = {
    RideType.race: "Race",
    RideType.race_gravel: "Race met Gravel",
    RideType.gravel: "Gravel",
}

_WEEKDAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
_MAANDEN = [
    "januari", "februari", "maart", "april", "mei", "juni",
    "juli", "augustus", "september", "oktober", "november", "december",
]


def _format_dutch_date(value: date) -> str:
    """Zelfde aanpak als `SLOT_LABELS` in services/rides.py: een handmatige
    NL-vertaling in plaats van de systeemlocale, die in de container niet
    Nederlands is ingesteld en dus 'Wednesday'/'September' zou teruggeven."""
    return f"{_WEEKDAGEN[value.weekday()]} {value.day} {_MAANDEN[value.month - 1]}"


class TelegramError(RuntimeError):
    """Een Telegram-API-call is mislukt of de integratie staat uit."""


def _call(method: str, **params: object) -> dict:
    settings = get_settings()
    if not settings.telegram_enabled:
        raise TelegramError("Telegram is niet geconfigureerd.")
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"
    try:
        response = requests.post(url, data=params, timeout=_API_TIMEOUT)
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise TelegramError(f"Telegram-verzoek '{method}' mislukt: {exc}") from exc
    if not data.get("ok"):
        raise TelegramError(data.get("description", "onbekende Telegram-fout"))
    return data["result"]


def send_message(chat_id: int | str, text: str) -> int:
    """Stuurt een bericht; geeft het `message_id` terug (nodig om te bewerken)."""
    result = _call("sendMessage", chat_id=chat_id, text=text)
    return result["message_id"]


def edit_message(chat_id: int | str, message_id: int, text: str) -> None:
    _call("editMessageText", chat_id=chat_id, message_id=message_id, text=text)


# ------------------------------------------------------------- ritberichten


def _ride_url(ride: Ride) -> str:
    settings = get_settings()
    return f"{settings.base_url}/ritten/{ride.id}"


def build_channel_text(ride: Ride, *, cancelled: bool = False) -> str:
    """Kanaalbericht voor een (niet-prive) rit.

    Bewust een eigen, eenvoudiger opzet dan `buildShareText` in de frontend
    (geen weerbericht: dat zou een extra externe call betekenen tijdens het
    aanmaken van de rit, voor iets dat toch al op de rit-pagina zelf te zien
    is). Wijzigt er iets aan de rit, dan wordt dit bericht bewerkt in plaats
    van dat er een nieuw bericht bijkomt (zie `routers/rides.py`).
    """
    lines: list[str] = []
    if cancelled:
        lines.append(f"🚫 GEANNULEERD: {ride.name}")
    else:
        lines.append(f"🚴 Nieuwe rit: {ride.name}")
    lines.append(f"🧭 Wegkapitein: {ride.owner.display_name}")
    lines.append(f"📅 {_format_dutch_date(ride.ride_date)} · {ride.ride_time.strftime('%H:%M')}")
    if ride.distance_km is not None:
        lines.append(f"🏁 {ride.distance_km:.0f} km")
    if ride.speed_kmh is not None:
        lines.append(f"🐢 {ride.speed_kmh:.0f} km/u")
    lines.append(f"🚴‍ Max. {ride.max_participants}")
    lines.append(f"🚲 {_RIDE_TYPE_LABELS[ride.ride_type]}")
    if not cancelled:
        lines.append("")
        lines.append(f"📈 Meer info en aanmelden: {_ride_url(ride)}")
    return "\n".join(lines)


def post_ride(db: Session, ride: Ride) -> None:
    """Post een nieuwe rit in het clubkanaal en onthoudt het bericht-id.

    Roept de aanroeper zelf aan (niet automatisch bij elke rit): prive-ritten
    mogen hier nooit in terechtkomen, dus die check gebeurt in de router, niet
    hier.
    """
    settings = get_settings()
    if not settings.telegram_channel_id:
        raise TelegramError("Geen Telegram-kanaal ingesteld.")
    message_id = send_message(settings.telegram_channel_id, build_channel_text(ride))
    ride.telegram_message_id = message_id
    ride.telegram_posted_at = utcnow()
    db.commit()


def update_ride_post(ride: Ride) -> None:
    """Werkt het bestaande kanaalbericht bij na een wijziging aan de rit."""
    settings = get_settings()
    if ride.telegram_message_id is None or not settings.telegram_channel_id:
        return
    edit_message(settings.telegram_channel_id, ride.telegram_message_id, build_channel_text(ride))


def mark_ride_cancelled(ride: Ride) -> None:
    """Zet het kanaalbericht op 'geannuleerd' vlak voordat de rit verwijderd wordt."""
    settings = get_settings()
    if ride.telegram_message_id is None or not settings.telegram_channel_id:
        return
    edit_message(
        settings.telegram_channel_id,
        ride.telegram_message_id,
        build_channel_text(ride, cancelled=True),
    )


# --------------------------------------------------------- account koppelen


def create_link_token(db: Session, user: User) -> str:
    settings = get_settings()
    raw = issue_email_token(
        db,
        user,
        TokenPurpose.telegram_link,
        timedelta(minutes=settings.telegram_link_token_ttl_minutes),
    )
    return raw


def link_deep_url(token: str) -> str:
    settings = get_settings()
    return f"https://t.me/{settings.telegram_bot_username}?start={token}"


def handle_webhook_update(db: Session, update: dict) -> None:
    """Verwerkt een binnenkomend Telegram-update. Op dit moment alleen `/start
    <token>` voor accountkoppeling; toekomstige botcommando's landen ook hier.
    """
    message = update.get("message")
    if not message or "text" not in message:
        return
    text = message["text"].strip()
    if not text.startswith("/start"):
        return
    chat_id = message["chat"]["id"]
    username = (message.get("from") or {}).get("username")
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        send_message(
            chat_id,
            "Deze link mist een koppelcode. Ga naar 'Mijn account' in het "
            "routeboek en klik daar op 'Telegram koppelen'.",
        )
        return

    token = parts[1].strip()
    record = consume_email_token(db, token, TokenPurpose.telegram_link)
    if record is None:
        send_message(
            chat_id,
            "Deze koppellink is verlopen of al gebruikt. Vraag in de app een "
            "nieuwe aan via 'Mijn account'.",
        )
        return

    user = db.get(User, record.user_id)
    if user is None:
        return
    user.telegram_chat_id = chat_id
    user.telegram_username = username
    user.telegram_linked_at = utcnow()
    db.commit()
    send_message(
        chat_id,
        f"✅ Gekoppeld aan je Routeboek-account, {user.display_name}. "
        "Je krijgt hier voortaan bv. de deelnemerslijst vlak voor een rit "
        "die je als wegkapitein organiseert.",
    )


def ensure_webhook() -> None:
    """Registreert het webhook-endpoint bij Telegram. Idempotent en veilig om
    bij elke start opnieuw aan te roepen."""
    settings = get_settings()
    if not settings.telegram_enabled:
        return
    try:
        _call(
            "setWebhook",
            url=f"{settings.base_url}/api/telegram/webhook",
            secret_token=settings.telegram_webhook_secret,
            allowed_updates='["message"]',
        )
        logger.info("telegram: webhook geregistreerd")
    except TelegramError:
        logger.exception("telegram: webhook registreren mislukt")


# ------------------------------------------------------- deelnemersreminder


def _due_rides(db: Session, now: datetime) -> list[Ride]:
    settings = get_settings()
    window_start = now - timedelta(minutes=settings.telegram_reminder_minutes_before + 2)
    return list(
        db.scalars(
            select(Ride)
            .where(
                Ride.organizer_reminder_sent_at.is_(None),
                Ride.cancelled_at.is_(None),
                Ride.ride_date >= (now - timedelta(days=1)).date(),
                Ride.ride_date <= (now + timedelta(days=2)).date(),
            )
            .options(
                selectinload(Ride.owner),
                selectinload(Ride.participants).selectinload(RideParticipant.user),
            )
        )
    )


def _reminder_text(ride: Ride) -> str:
    lines = [
        f"🔔 '{ride.name}' vertrekt over {get_settings().telegram_reminder_minutes_before} "
        f"minuten ({ride.ride_time.strftime('%H:%M')}).",
        "",
        f"Deelnemers ({len(ride.participants)}/{ride.max_participants}):",
    ]
    lines += [f"• {p.user.display_name}" for p in ride.participants]
    return "\n".join(lines)


def _send_due_reminders() -> None:
    settings = get_settings()
    if not settings.telegram_enabled:
        return
    now = datetime.now()
    db = SessionLocal()
    try:
        for ride in _due_rides(db, now):
            ride_dt = datetime.combine(ride.ride_date, ride.ride_time)
            remind_at = ride_dt - timedelta(minutes=settings.telegram_reminder_minutes_before)
            if not (remind_at <= now < ride_dt):
                continue
            if ride.owner.telegram_chat_id is None:
                continue
            try:
                send_message(ride.owner.telegram_chat_id, _reminder_text(ride))
            except TelegramError:
                logger.exception("telegram: reminder voor rit %s mislukt", ride.id)
                continue
            ride.organizer_reminder_sent_at = utcnow()
            db.commit()
    finally:
        db.close()


def start_reminder_loop() -> None:
    """Achtergrondthread die elke minuut kijkt of er een reminder verstuurd
    moet worden. Minuutgranulariteit is nodig omdat de standaardinstelling
    (5 minuten van tevoren) anders gemist kan worden."""

    def loop() -> None:
        while True:
            try:
                _send_due_reminders()
            except Exception:  # noqa: BLE001
                logger.exception("telegram: reminderronde mislukt")
            time.sleep(60)

    threading.Thread(target=loop, name="telegram-reminder", daemon=True).start()
