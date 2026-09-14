"""Backup en restore vanaf de beheerpagina.

Eigen router en niet in `admin.py`, omdat backup een eigen levenscyclus heeft:
achtergrondtaken met voortgang, bestandsuploads en -downloads. Alles zit achter
`current_admin`; de setup-wizard heeft een eigen ingang met een setup-token (zie
`routers/setup.py`).
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
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse

from app.deps import current_admin
from app.models import User
from app.schemas import BackupJobOut, BackupListOut, BackupOut, Message
from app.services import backup as backup_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/backups", tags=["backup"])

#: Een volledige backup met media is ~140 MB; ruim boven de marge, maar niet
#: ongelimiteerd, zodat een upload de schijf niet kan vullen.
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
CHUNK = 1024 * 1024


def _to_out(info: backup_service.BackupInfo) -> BackupOut:
    return BackupOut(
        name=info.name,
        kind=info.kind,
        size_bytes=info.size_bytes,
        created_at=info.created_at,
        has_media=info.has_media,
        alembic_revision=info.alembic_revision,
    )


def _job_out() -> BackupJobOut | None:
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


@router.get("", response_model=BackupListOut)
def list_backups(admin: User = Depends(current_admin)) -> BackupListOut:
    items = [_to_out(info) for info in backup_service.list_backups()]
    return BackupListOut(
        items=items,
        job=_job_out(),
        keep_auto=backup_service.KEEP_AUTO,
        keep_weekly=backup_service.KEEP_WEEKLY,
        backup_hour=backup_service.BACKUP_HOUR,
    )


@router.post("", response_model=BackupJobOut, status_code=status.HTTP_202_ACCEPTED)
def create_backup(
    include_media: bool = Query(default=False),
    admin: User = Depends(current_admin),
) -> BackupJobOut:
    try:
        backup_service.start_backup("manual", include_media=include_media)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    logger.info(
        "Backup gestart door %s (media=%s)", admin.email, include_media
    )
    job = _job_out()
    assert job is not None
    return job


@router.get("/job", response_model=BackupJobOut | None)
def job_status(admin: User = Depends(current_admin)) -> BackupJobOut | None:
    return _job_out()


@router.post("/upload", response_model=BackupOut, status_code=status.HTTP_201_CREATED)
async def upload_backup(
    file: UploadFile = File(...),
    admin: User = Depends(current_admin),
) -> BackupOut:
    """Neem een aangeleverd backupbestand op in de backupmap.

    Het bestand wordt eerst naar een tijdelijke plek geschreven en pas verplaatst
    nadat het manifest is herkend; zo belandt er nooit een onbruikbaar of
    vijandig archief tussen de echte backups.
    """
    original = Path(file.filename or "").name
    if not original.endswith(".tar.gz"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alleen een .tar.gz-backup is geldig.",
        )

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"routeboek-manual-{stamp}-upload.tar.gz"
    target = backup_service.resolve(name)

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

    shutil.move(str(temp_path), str(target))
    logger.info("Backup %s geüpload door %s", name, admin.email)
    info = next(
        (item for item in backup_service.list_backups() if item.name == name), None
    )
    if info is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="De backup kon niet worden gelezen na het uploaden.",
        )
    return _to_out(info)


@router.get("/{name}")
def download_backup(name: str, admin: User = Depends(current_admin)) -> FileResponse:
    path = _existing(name)
    logger.info("Backup %s gedownload door %s", name, admin.email)
    return FileResponse(path, filename=name, media_type="application/gzip")


@router.delete("/{name}", response_model=Message)
def delete_backup(name: str, admin: User = Depends(current_admin)) -> Message:
    _existing(name)
    backup_service.delete_backup(name)
    logger.info("Backup %s verwijderd door %s", name, admin.email)
    return Message(detail="Backup verwijderd.")


@router.post("/{name}/restore", response_model=BackupJobOut, status_code=status.HTTP_202_ACCEPTED)
def restore_backup(name: str, admin: User = Depends(current_admin)) -> BackupJobOut:
    """Zet een backup terug. Onomkeerbaar: alle huidige gegevens verdwijnen."""
    _existing(name)
    try:
        backup_service.start_restore(name)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    logger.warning("Backup %s wordt teruggezet door %s", name, admin.email)
    job = _job_out()
    assert job is not None
    return job


def _existing(name: str) -> Path:
    try:
        path = backup_service.resolve(name)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deze backup bestaat niet."
        )
    return path
