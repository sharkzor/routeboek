"""Eerste installatie van een verse omgeving.

Dit is — naast `/api/auth/*`, `/api/health` en `/api/telegram/webhook` — de
laatste uitzondering op de regel dat elk endpoint authenticatie vereist. De
grendels die dat afdekken staan in `app/services/setup.py`.

De wizard is opzettelijk klein gehouden: zodra het beheerdersaccount bestaat,
logt hij dat account in en lopen alle vervolgstappen (mail, Telegram, clubnaam)
via de gewone `/api/admin/settings`-endpoints, achter een echte sessie. Zo blijft
het ongeauthenticeerde oppervlak beperkt tot de drie endpoints hieronder.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import client_ip, set_auth_cookies
from app.models import User, utcnow
from app.schemas import BackupJobOut, SetupAdminIn, SetupStatusOut, UserOut
from app.security import create_session, hash_password, normalize_email
from app.services import backup as backup_service
from app.services import setup as setup_service
from app.settings_store import mark_setup_completed

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/setup", tags=["setup"])

#: Gelijk aan de limieten in routers/backup.py; een volledige backup met media
#: is ~140 MB, maar ongelimiteerd uploaden mag een verse server niet vullen.
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
CHUNK = 1024 * 1024


def allow_setup(
    request: Request,
    db: Session = Depends(get_db),
    x_setup_token: str | None = Header(default=None),
) -> None:
    """Gedeelde grendel voor elk setup-endpoint dat iets wijzigt.

    Bewust één dependency in plaats van een controle per endpoint: zo kun je hem
    nergens vergeten wanneer er later een stap bijkomt.
    """
    ip = client_ip(request)
    if not setup_service.setup_required(db):
        logger.warning("Setup-verzoek geweigerd (installatie is al voltooid) van %s", ip)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="De installatie is al voltooid.",
        )
    if not setup_service.token_valid(x_setup_token):
        logger.warning("Setup-verzoek met ongeldig token van %s", ip)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ongeldig setup-token.",
        )


@router.get("/status", response_model=SetupStatusOut)
def setup_status(db: Session = Depends(get_db)) -> SetupStatusOut:
    """Of de wizard getoond moet worden.

    Het enige setup-endpoint zonder token: de frontend moet kunnen weten of hij
    de wizard of het inlogscherm laat zien. Het verraadt hooguit dat een
    installatie nog leeg is, en zonder token valt daar niets mee te beginnen.
    """
    return SetupStatusOut(required=setup_service.setup_required(db))


@router.post(
    "/restore",
    response_model=BackupJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(allow_setup)],
)
async def restore_from_backup(
    file: UploadFile = File(...),
) -> BackupJobOut:
    """Richt een verse omgeving in vanuit een backup van een andere server.

    Dit is de tegenhanger van de backupknop op de beheerpagina en het bedoelde
    pad om te verhuizen naar een hoster of Azure: draai de container met alleen
    DATABASE_URL, upload hier het backupbestand en log daarna in met je oude
    account.

    Het archief wordt eerst op manifest gecontroleerd en op padtrucs nagelopen
    voordat er iets wordt uitgepakt (zie `services/backup.py`).
    """
    original = Path(file.filename or "").name
    if not original.endswith(".tar.gz"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alleen een .tar.gz-backup is geldig.",
        )

    with tempfile.NamedTemporaryFile(delete=False, suffix=".tar.gz") as tmp:
        temp_path = Path(tmp.name)
        written = 0
        while chunk := await file.read(CHUNK):
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                tmp.close()
                temp_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Het bestand is te groot.",
                )
            tmp.write(chunk)

    try:
        backup_service.inspect(temp_path)
    except ValueError as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    # In de backupmap zetten zodat het bestand de restore overleeft en de
    # beheerder hem daarna gewoon in de lijst terugziet.
    name = f"routeboek-manual-{datetime.now():%Y%m%d-%H%M%S}-hersteld.tar.gz"
    target = backup_service.resolve(name)
    shutil.move(str(temp_path), str(target))

    try:
        job = backup_service.start_restore(name)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc

    logger.warning("Installatie via backup %s gestart", name)
    return BackupJobOut(
        action=job.action,
        state=job.state,
        message=job.message,
        progress=job.progress,
        error=job.error,
        result=job.result,
    )


@router.get("/restore/job", response_model=BackupJobOut | None)
def restore_job(db: Session = Depends(get_db)) -> BackupJobOut | None:
    """Voortgang van de installatie-restore.

    Zonder token, en met opzet: zodra de restore klaar is staat de installatie
    op voltooid en zou een tokencontrole een `409` geven, precies op het moment
    dat de wizard de laatste voortgang wil tonen. Het lekt niets — alleen of er
    een taak loopt.
    """
    job = backup_service.current_job()
    if job is None:
        return None
    return BackupJobOut(
        action=job.action,
        state=job.state,
        message=job.message,
        progress=job.progress,
        error=job.error,
        result=job.result,
    )
@router.post(
    "/admin",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(allow_setup)],
)
def create_first_admin(
    payload: SetupAdminIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> User:
    """Maak de eerste beheerder aan, grendel de wizard en log meteen in.

    Het account is direct bevestigd (`email_verified_at`): op een verse
    installatie is de mail nog niet ingesteld, dus verificatie eisen zou de
    beheerder meteen buitensluiten.

    Het aanmaken en het grendelen gebeuren in één commit, zodat er geen
    tussentoestand bestaat waarin er wél een account is maar de wizard nog
    open staat.
    """
    user = User(
        email=normalize_email(payload.email),
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        is_admin=True,
        is_active=True,
        email_verified_at=utcnow(),
    )
    db.add(user)
    mark_setup_completed(db)
    db.commit()
    db.refresh(user)

    setup_service.clear_token()

    session, raw = create_session(
        db, user, request.headers.get("user-agent"), client_ip(request)
    )
    set_auth_cookies(response, raw, session.csrf_token)
    logger.info("Installatie voltooid; beheerder %s aangemaakt", user.email)
    return user
