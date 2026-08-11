"""pg_dump / pg_restore helpers and the scheduled-backup job.

Backups are stored as custom-format (``-Fc``) dumps under ``BACKUP_DIR`` with a
metadata row per file. The schedule is a singleton row; the scheduler tick
guards itself with a Postgres advisory lock so that only one worker process
runs the job at a time (the backend runs with multiple workers).
"""

import calendar
import json
import logging
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models import (
    Backup,
    BackupFrequency,
    BackupKind,
    BackupSchedule,
    BackupStatus,
    RestoreState,
)

logger = logging.getLogger(__name__)

DUMP_SUFFIX = ".dump"

# Shared advisory lock so concurrent scheduler ticks (one per worker process)
# never run the same job twice.
SCHEDULE_ADVISORY_LOCK_KEY = 0x5445500A1D0000

_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class BackupError(RuntimeError):
    """Raised when a pg_* subprocess exits with a non-zero status."""


def backup_dir() -> Path:
    path = Path(settings.BACKUP_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _env() -> dict[str, str]:
    return {**os.environ, "PGPASSWORD": settings.POSTGRES_PASSWORD}


def _base_pg_args() -> list[str]:
    return [
        "-h",
        settings.POSTGRES_SERVER,
        "-p",
        str(settings.POSTGRES_PORT),
        "-U",
        settings.POSTGRES_USER,
    ]


def run_command(args: list[str]) -> str:
    """Run a pg_* subprocess; raise ``BackupError`` with stderr on failure."""
    result = subprocess.run(
        args, env=_env(), capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise BackupError(
            f"command failed (exit {result.returncode}): {' '.join(args)}\n"
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stderr.strip()


def _shorten(message: str, limit: int = 500) -> str:
    return message if len(message) <= limit else message[: limit - 3] + "..."


def build_filename(now: datetime | None = None) -> str:
    now = now or datetime.now().astimezone()
    return f"tempos_backup_{now:%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}{DUMP_SUFFIX}"


def run_pg_dump(target_path: Path) -> int:
    """Dump the whole database in custom format into ``target_path``."""
    run_command(
        [
            "pg_dump",
            "-Fc",
            *_base_pg_args(),
            "-d",
            settings.POSTGRES_DB,
            "-f",
            str(target_path),
        ]
    )
    return target_path.stat().st_size


def prune_backups(session: Session, retention: int) -> None:
    """Delete the backups beyond the retention window (file + row)."""
    rows = list(
        session.exec(
            select(Backup).order_by(col(Backup.created_at).desc()).offset(retention)
        ).all()
    )
    for backup in rows:
        (backup_dir() / backup.filename).unlink(missing_ok=True)
        session.delete(backup)


def create_backup(
    session: Session, *, kind: BackupKind, user_id: uuid.UUID | None
) -> Backup:
    """Run a dump, record it and prune per the schedule retention.

    Does not commit; the caller controls the transaction.
    """
    path = backup_dir() / build_filename()
    try:
        size = run_pg_dump(path)
        backup = Backup(
            filename=path.name,
            size_bytes=size,
            kind=kind,
            status=BackupStatus.SUCCESS,
            created_by_id=user_id,
        )
    except Exception as exc:
        path.unlink(missing_ok=True)
        logger.exception("pg_dump failed")
        backup = Backup(
            filename=path.name,
            size_bytes=0,
            kind=kind,
            status=BackupStatus.FAILED,
            error=_shorten(str(exc)),
            created_by_id=user_id,
        )
    session.add(backup)
    schedule = session.get(BackupSchedule, 1)
    prune_backups(session, schedule.retention if schedule else 14)
    return backup


def get_schedule(session: Session) -> BackupSchedule:
    schedule = session.get(BackupSchedule, 1)
    if schedule is None:
        schedule = BackupSchedule(id=1, next_run_at=compute_next_run(BackupSchedule()))
        session.add(schedule)
        session.commit()
        session.refresh(schedule)
    return schedule


def _days_in_month(day: datetime) -> int:
    return calendar.monthrange(day.year, day.month)[1]


def compute_next_run(schedule: BackupSchedule, now: datetime | None = None) -> datetime:
    """Next occurrence of the schedule in the server's local time."""
    now = now or datetime.now().astimezone()
    hour, minute = (int(part) for part in schedule.run_time.split(":"))
    base = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if base <= now:
        base += timedelta(days=1)
    if schedule.frequency == BackupFrequency.WEEKLY:
        target = schedule.day_of_week if schedule.day_of_week is not None else 0
        base += timedelta(days=(target - base.weekday()) % 7)
    elif schedule.frequency == BackupFrequency.MONTHLY:
        day = schedule.day_of_month if schedule.day_of_month is not None else 1
        for _ in range(31):
            if base.day == min(day, _days_in_month(base)):
                return base
            base += timedelta(days=1)
        raise BackupError("could not compute the next monthly backup run")
    return base


def _validate_identifier(value: str, label: str) -> None:
    if not _SAFE_IDENTIFIER.match(value):
        raise BackupError(f"unsafe {label}: {value!r}")


RESTORE_STATE_FILE = "restore_state.json"

# A restore is recorded as RUNNING before the worker runs; if the worker dies
# (deploy, --reload restart, crash) nothing would ever flip the state back,
# permanently blocking backups and restores. Treat RUNNING states older than
# this threshold as interrupted and mark them FAILED.
RESTORE_STALE_AFTER = timedelta(minutes=30)


def _idle_state() -> dict[str, Any]:
    return {
        "estado": RestoreState.IDLE.value,
        "source_filename": None,
        "started_at": None,
        "finished_at": None,
        "error": None,
    }


def read_restore_state() -> dict[str, Any]:
    """Read the restore progress from the state file (never the DB: the DB
    itself is dropped while a restore runs)."""
    path = backup_dir() / RESTORE_STATE_FILE
    try:
        data = json.loads(path.read_text())
    except OSError, ValueError:
        return _idle_state()
    expected = set(_idle_state())
    if not isinstance(data, dict) or not expected.issubset(data):
        return _idle_state()
    return data


def write_restore_state(
    estado: RestoreState,
    source_filename: str | None = None,
    error: str | None = None,
    *,
    started_at: datetime | None = None,
) -> None:
    # Preserve fields not being updated (started_at, source_filename) from the
    # previous state so a final SUCCESS/FAILED write does not erase them.
    previous = read_restore_state()
    state = {
        "estado": estado.value,
        "source_filename": (
            source_filename
            if source_filename is not None
            else previous.get("source_filename")
        ),
        "started_at": (
            started_at.isoformat() if started_at else previous.get("started_at")
        ),
        "finished_at": (
            datetime.now().astimezone().isoformat()
            if estado in (RestoreState.SUCCESS, RestoreState.FAILED)
            else None
        ),
        "error": error,
    }
    backup_dir().joinpath(RESTORE_STATE_FILE).write_text(json.dumps(state, indent=2))


def recover_stale_restore() -> None:
    """Mark an orphaned RUNNING restore as FAILED so the module unblocks."""
    state = read_restore_state()
    if state["estado"] != RestoreState.RUNNING.value:
        return
    started = state.get("started_at")
    if started is None:
        return
    try:
        started_dt = datetime.fromisoformat(started)
    except ValueError:
        return
    if datetime.now().astimezone() - started_dt >= RESTORE_STALE_AFTER:
        write_restore_state(
            RestoreState.FAILED,
            state.get("source_filename"),
            "The restore was interrupted before it finished",
        )


def restore_database(source_path: Path, source_filename: str) -> None:
    """Drop/recreate the database and restore ``source_path`` into it.

    Runs detached from the API process (see ``start_restore``):
    ``DROP DATABASE ... WITH (FORCE)`` terminates the running backend's
    pooled connections; the app reconnects automatically once the restore
    finishes.
    """
    database = settings.POSTGRES_DB
    owner = settings.POSTGRES_USER
    try:
        _validate_identifier(database, "database name")
        _validate_identifier(owner, "database owner")
        run_command(
            [
                "psql",
                *_base_pg_args(),
                "-d",
                "postgres",
                "-c",
                f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);',
            ]
        )
        run_command(
            [
                "psql",
                *_base_pg_args(),
                "-d",
                "postgres",
                "-c",
                f'CREATE DATABASE "{database}" OWNER "{owner}";',
            ]
        )
        run_command(
            [
                "pg_restore",
                *_base_pg_args(),
                "--no-owner",
                "--no-privileges",
                "-Fc",
                "-d",
                database,
                str(source_path),
            ]
        )
        write_restore_state(RestoreState.SUCCESS, source_filename)
    except Exception as exc:
        logger.exception("database restore failed")
        write_restore_state(RestoreState.FAILED, source_filename, _shorten(str(exc)))
    finally:
        # Uploaded restore sources are temporary; stored backups are kept.
        if source_path.name.startswith("restore_upload_"):
            source_path.unlink(missing_ok=True)


def start_restore(source_path: Path, source_filename: str) -> None:
    """Run the restore in a detached subprocess that survives API restarts."""
    subprocess.Popen(
        [
            sys.executable,
            "-m",
            "app.core.restore_worker",
            str(source_path),
            source_filename,
        ],
        start_new_session=True,
    )


def run_scheduled_backups() -> None:
    """Scheduler job: run a backup when due; safe across worker processes."""
    try:
        with Session(engine) as session:
            _scheduled_tick(session)
    except Exception:
        logger.exception("scheduled backup tick failed")


def _scheduled_tick(session: Session) -> None:
    schedule = session.get(BackupSchedule, 1)
    if schedule is None or not schedule.enabled:
        return
    now = datetime.now().astimezone()
    if schedule.next_run_at is None or schedule.next_run_at > now:
        return
    locked = session.exec(
        select(func.pg_try_advisory_xact_lock(SCHEDULE_ADVISORY_LOCK_KEY))
    ).one()
    if not locked:
        return
    recover_stale_restore()
    if read_restore_state()["estado"] == RestoreState.RUNNING.value:
        return
    backup = create_backup(session, kind=BackupKind.SCHEDULED, user_id=None)
    schedule.last_run_at = now
    schedule.last_status = backup.status
    schedule.last_error = backup.error
    schedule.next_run_at = compute_next_run(schedule, now)
    session.add(schedule)
    session.commit()
