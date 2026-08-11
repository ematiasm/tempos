import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlmodel import col, select

from app.api.deps import CurrentUser, PaginationDep, SessionDep, require_permissions
from app.core import backup as backup_service
from app.models import (
    Backup,
    BackupFrequency,
    BackupKind,
    BackupPublic,
    BackupSchedulePublic,
    BackupScheduleUpdate,
    Page,
    RestoreState,
    RestoreStatusPublic,
    User,
)

router = APIRouter(prefix="/backups", tags=["backups"])


def _get_restore_status() -> RestoreStatusPublic:
    backup_service.recover_stale_restore()
    return RestoreStatusPublic(**backup_service.read_restore_state())


def _resolve_names(session: SessionDep, backups: list[Backup]) -> dict[uuid.UUID, str]:
    user_ids = {b.created_by_id for b in backups if b.created_by_id}
    if not user_ids:
        return {}
    return {
        u.id: u.full_name or u.email
        for u in session.exec(select(User).where(col(User.id).in_(user_ids))).all()
    }


def _to_public(backup: Backup, names: dict[uuid.UUID, str]) -> BackupPublic:
    item = BackupPublic.model_validate(backup)
    item.created_by_name = (
        names.get(backup.created_by_id) if backup.created_by_id else None
    )
    return item


@router.get(
    "/",
    response_model=Page[BackupPublic],
    dependencies=[require_permissions("backup.read")],
)
def read_backups(session: SessionDep, pagination: PaginationDep) -> Any:
    """List stored backups, newest first."""
    count = session.exec(select(func.count()).select_from(Backup)).one()
    rows = session.exec(
        select(Backup)
        .order_by(col(Backup.created_at).desc())
        .offset(pagination.skip)
        .limit(pagination.limit)
    ).all()
    names = _resolve_names(session, list(rows))
    data = [_to_public(backup, names) for backup in rows]
    return Page[BackupPublic](data=data, count=count)


@router.post(
    "/run-now",
    response_model=BackupPublic,
    dependencies=[require_permissions("backup.create")],
)
def create_backup_now(session: SessionDep, current_user: CurrentUser) -> Any:
    """Create a backup immediately (manual, synchronous)."""
    if _get_restore_status().estado == RestoreState.RUNNING:
        raise HTTPException(
            status_code=409, detail="A restore is in progress; backups are disabled"
        )
    backup = backup_service.create_backup(
        session, kind=BackupKind.MANUAL, user_id=current_user.id
    )
    session.commit()
    session.refresh(backup)
    return _to_public(backup, _resolve_names(session, [backup]))


@router.get(
    "/{backup_id}/download",
    dependencies=[require_permissions("backup.read")],
)
def download_backup(backup_id: uuid.UUID, session: SessionDep) -> Any:
    """Download a stored backup dump."""
    backup = session.get(Backup, backup_id)
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    path = backup_service.backup_dir() / backup.filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=backup.filename,
    )


@router.delete(
    "/{backup_id}",
    status_code=204,
    dependencies=[require_permissions("backup.delete")],
)
def delete_backup(backup_id: uuid.UUID, session: SessionDep) -> None:
    """Delete a stored backup (file + metadata)."""
    backup = session.get(Backup, backup_id)
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    (backup_service.backup_dir() / backup.filename).unlink(missing_ok=True)
    session.delete(backup)
    session.commit()


@router.get(
    "/schedule",
    response_model=BackupSchedulePublic,
    dependencies=[require_permissions("backup.read")],
)
def read_backup_schedule(session: SessionDep) -> Any:
    """Get the automatic backup schedule (singleton row)."""
    return backup_service.get_schedule(session)


@router.put(
    "/schedule",
    response_model=BackupSchedulePublic,
    dependencies=[require_permissions("backup.schedule")],
)
def update_backup_schedule(
    session: SessionDep, schedule_in: BackupScheduleUpdate
) -> Any:
    """Update the automatic backup schedule and recompute the next run."""
    schedule = backup_service.get_schedule(session)
    data = schedule_in.model_dump(exclude_unset=True)
    frequency = data.get("frequency", schedule.frequency)
    if frequency == BackupFrequency.WEEKLY:
        day = data.get("day_of_week", schedule.day_of_week)
        if day is None:
            raise HTTPException(
                status_code=422,
                detail="day_of_week is required for a weekly schedule",
            )
    elif frequency == BackupFrequency.MONTHLY:
        day = data.get("day_of_month", schedule.day_of_month)
        if day is None:
            raise HTTPException(
                status_code=422,
                detail="day_of_month is required for a monthly schedule",
            )
    else:
        data["day_of_week"] = None
        data["day_of_month"] = None
    schedule.sqlmodel_update(data)
    schedule.next_run_at = backup_service.compute_next_run(schedule)
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    return schedule


@router.get(
    "/restore-status",
    response_model=RestoreStatusPublic,
    dependencies=[require_permissions("backup.read")],
)
def read_restore_status() -> Any:
    """Get the state of the last/current database restore."""
    return _get_restore_status()


@router.post(
    "/restore",
    status_code=202,
    response_model=RestoreStatusPublic,
    dependencies=[require_permissions("backup.restore")],
)
def restore_backup(
    session: SessionDep,
    file: UploadFile | None = File(default=None),
    backup_id: uuid.UUID | None = Form(default=None),
) -> Any:
    """Restore the whole database from an uploaded dump or a stored backup.

    Runs detached from the API process: the current database is dropped and
    recreated, so the API is briefly unavailable while the restore runs.
    """
    if _get_restore_status().estado == RestoreState.RUNNING:
        raise HTTPException(status_code=409, detail="A restore is already running")
    if file is None and backup_id is None:
        raise HTTPException(
            status_code=400,
            detail="Provide either a backup file or an existing backup_id",
        )
    if file is not None:
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        if size == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty")
        dest = (
            backup_service.backup_dir()
            / f"restore_upload_{uuid.uuid4().hex}{backup_service.DUMP_SUFFIX}"
        )
        with dest.open("wb") as out:
            shutil.copyfileobj(file.file, out)
        source_path: Path = dest
        source_filename = file.filename or dest.name
    else:
        backup = session.get(Backup, backup_id)
        if not backup:
            raise HTTPException(status_code=404, detail="Backup not found")
        source_path = backup_service.backup_dir() / backup.filename
        if not source_path.is_file():
            raise HTTPException(status_code=404, detail="Backup file not found")
        source_filename = backup.filename

    backup_service.write_restore_state(
        RestoreState.RUNNING,
        source_filename,
        started_at=datetime.now().astimezone(),
    )
    backup_service.start_restore(source_path, source_filename)
    return _get_restore_status()
