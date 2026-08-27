"""pg_dump / pg_restore helpers and the scheduled-backup job.

Backups are stored as custom-format (``-Fc``) dumps under ``BACKUP_DIR`` with a
metadata row per file. The schedule is a singleton row; the scheduler tick
guards itself with a Postgres advisory lock so that only one worker process
runs the job at a time (the backend runs with multiple workers).
"""

import calendar
import fcntl
import json
import logging
import os
import re
import subprocess
import sys
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta, tzinfo
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models import (
    Backup,
    BackupFrequency,
    BackupKind,
    BackupRunState,
    BackupSchedule,
    BackupStatus,
    BusinessSettings,
    RestoreState,
    User,
)
from app.utils import render_email_template, send_email

logger = logging.getLogger(__name__)

DUMP_SUFFIX = ".dump"

# Matches the filenames produced by build_filename(): the timestamp embedded in
# the name is the dump time in the business timezone (see system_now).
_BACKUP_FILENAME_RE = re.compile(
    rf"^tempos_backup_(\d{{8}}_\d{{6}})_[0-9a-f]{{8}}{re.escape(DUMP_SUFFIX)}$"
)

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
    """Run a pg_* subprocess; raise ``BackupError`` with stderr on failure.

    Returns the captured stdout (used to read query results back from psql).
    """
    result = subprocess.run(
        args, env=_env(), capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise BackupError(
            f"command failed (exit {result.returncode}): {' '.join(args)}\n"
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout.strip()


def _shorten(message: str, limit: int = 500) -> str:
    return message if len(message) <= limit else message[: limit - 3] + "..."


def _notify_backup_failure(*, kind: str, error: str) -> None:
    """Email every superuser when a backup or restore fails."""
    try:
        if not settings.emails_enabled:
            logger.warning("email notifications disabled; skipping backup alert")
            return
        with Session(engine) as session:
            emails = [
                user.email
                for user in session.exec(
                    select(User).where(col(User.is_superuser).is_(True))
                ).all()
            ]
        if not emails:
            return
        now = datetime.now().astimezone()
        html = render_email_template(
            template_name="backup_failed.html",
            context={
                "project_name": settings.PROJECT_NAME,
                "kind": kind,
                "time": now.strftime("%Y-%m-%d %H:%M %Z"),
                "error": error,
            },
        )
        for email in emails:
            send_email(
                email_to=email,
                subject=f"[{settings.PROJECT_NAME}] Backup failed",
                html_content=html,
            )
    except Exception:
        logger.exception("failed to send backup failure alert")


DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires"


def system_now(session: Session) -> datetime:
    """Current time in the business timezone configured in BusinessSettings."""
    tz_name = DEFAULT_TIMEZONE
    business = session.get(BusinessSettings, 1)
    if business is not None and business.timezone:
        tz_name = business.timezone
    try:
        return datetime.now(ZoneInfo(tz_name))
    except ZoneInfoNotFoundError:
        return datetime.now(ZoneInfo(DEFAULT_TIMEZONE))


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
    """Delete the backups beyond the retention window (file + row).

    Also drops rows whose dump file no longer exists on disk (failed runs and
    stale references restored from older dumps) so the list never shows
    backups that cannot be downloaded or restored.
    """
    rows = list(
        session.exec(
            select(Backup).order_by(col(Backup.created_at).desc()).offset(retention)
        ).all()
    )
    for backup in rows:
        (backup_dir() / backup.filename).unlink(missing_ok=True)
        session.delete(backup)
    # Drop rows that should have a dump on disk but no longer do (stale
    # references restored from older dumps). FAILED rows never have a file and
    # stay as an error record for the user.
    orphaned = session.exec(
        select(Backup).where(col(Backup.status) != BackupStatus.FAILED)
    ).all()
    for backup in orphaned:
        if not (backup_dir() / backup.filename).is_file():
            session.delete(backup)


def _backup_created_at_from_name(filename: str, tz: tzinfo) -> datetime | None:
    """Parse the dump timestamp embedded in the filename as UTC.

    Returns None when the name does not follow the build_filename() pattern
    (e.g. files copied from elsewhere), so callers can fall back to mtime.
    """
    match = _BACKUP_FILENAME_RE.match(filename)
    if match is None:
        return None
    try:
        local = datetime.strptime(match.group(1), "%Y%m%d_%H%M%S").replace(tzinfo=tz)
    except ValueError:
        return None
    return local.astimezone(UTC)


def sync_backup_rows(session: Session) -> int:
    """Import dump files present on disk but missing a Backup row.

    The metadata table can fall out of sync with the volume when the database
    is recreated/restored while BACKUP_DIR persists (the files remain, the
    rows they described are gone). Importing them makes the backups panel show
    every stored dump. Idempotent: existing rows are left untouched and the
    unique filename constraint (ON CONFLICT DO NOTHING) makes concurrent
    workers safe. Restore-upload temp files are never imported.
    """
    tz = system_now(session).tzinfo or ZoneInfo(DEFAULT_TIMEZONE)
    existing = set(session.exec(select(Backup.filename)).all())
    imported = 0
    for path in backup_dir().glob(f"*{DUMP_SUFFIX}"):
        if path.name.startswith("restore_upload_") or path.name in existing:
            continue
        created_at = _backup_created_at_from_name(path.name, tz)
        if created_at is None:
            created_at = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        session.exec(
            pg_insert(Backup)
            .values(
                filename=path.name,
                size_bytes=path.stat().st_size,
                kind=BackupKind.MANUAL,
                status=BackupStatus.SUCCESS,
                created_at=created_at,
            )
            .on_conflict_do_nothing(index_elements=["filename"])
        )
        imported += 1
    if imported:
        session.commit()
    return imported


def create_backup(
    session: Session, *, kind: BackupKind, user_id: uuid.UUID | None
) -> Backup:
    """Run a dump, record it and prune per the schedule retention.

    Does not commit; the caller controls the transaction.
    """
    path = backup_dir() / build_filename(system_now(session))
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


def _write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    """Write a JSON state file atomically so readers never see it half-written."""
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, path)


def read_restore_state() -> dict[str, Any]:
    """Read the restore progress from the state file (never the DB: the DB
    itself is dropped while a restore runs). Corrupt or malformed files fall
    back to the idle state instead of raising."""
    path = backup_dir() / RESTORE_STATE_FILE
    try:
        data = json.loads(path.read_text())
    except OSError, ValueError:
        return _idle_state()
    expected = set(_idle_state())
    if not isinstance(data, dict) or not expected.issubset(data):
        return _idle_state()
    if data.get("estado") not in {state.value for state in RestoreState}:
        return _idle_state()
    for key in ("started_at", "finished_at"):
        value = data.get(key)
        if value is not None:
            try:
                datetime.fromisoformat(value)
            except TypeError, ValueError:
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
    _write_json_atomic(backup_dir() / RESTORE_STATE_FILE, state)


def _as_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.astimezone()


def recover_stale_restore() -> None:
    """Mark an orphaned RUNNING restore as FAILED so the module unblocks."""
    state = read_restore_state()
    if state["estado"] != RestoreState.RUNNING.value:
        return
    started = state.get("started_at")
    if started is None:
        return
    try:
        started_dt = _as_aware(datetime.fromisoformat(started))
    except TypeError, ValueError:
        return
    if datetime.now().astimezone() - started_dt >= RESTORE_STALE_AFTER:
        write_restore_state(
            RestoreState.FAILED,
            state.get("source_filename"),
            "The restore was interrupted before it finished",
        )


@contextmanager
def restore_lock() -> Any:
    """Non-blocking exclusive lock guarding restore startup (the state file
    doubles as the lock target). Raises ``BackupError`` when another restore
    is already starting so two concurrent requests cannot both spawn a worker.
    """
    path = backup_dir() / RESTORE_STATE_FILE
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise BackupError("another restore is already running")
    try:
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _query_db(query: str, database: str) -> str:
    return run_command(
        [
            "psql",
            *_base_pg_args(),
            "-d",
            database,
            "-t",
            "-A",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            query,
        ]
    )


def restore_database(source_path: Path, source_filename: str) -> None:
    """Drop/recreate the database and restore ``source_path`` into it.

    Runs detached from the API process (see ``start_restore``):
    ``DROP DATABASE ... WITH (FORCE)`` terminates the running backend's
    pooled connections; the app reconnects automatically once the restore
    finishes.

    After the dump is restored, migrations are re-applied so the schema
    matches the current code even when the dump came from an older version.
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
                "--exit-on-error",
                "-Fc",
                "-d",
                database,
                str(source_path),
            ]
        )
        # The dump must carry the alembic bookkeeping; without it the restored
        # database cannot be migrated and the app would break against it.
        if not _query_db("select version_num from alembic_version;", database):
            raise BackupError(
                "the dump does not contain alembic_version; refusing to mark "
                "the restore as successful"
            )
        run_command(["alembic", "upgrade", "head"])
        write_restore_state(RestoreState.SUCCESS, source_filename)
    except Exception as exc:
        logger.exception("database restore failed")
        error = _shorten(str(exc))
        write_restore_state(RestoreState.FAILED, source_filename, error)
        _notify_backup_failure(kind="restore", error=error)
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


BACKUP_STATE_FILE = "backup_state.json"

# Same staleness guard as the restore state: a RUNNING backup whose worker
# died (crash, container restart) would otherwise block run-now forever.
BACKUP_RUN_STALE_AFTER = timedelta(minutes=30)


def recover_stale_backup_run() -> None:
    """Mark an orphaned RUNNING manual backup as FAILED so run-now unblocks."""
    state = read_backup_run_state()
    if state["estado"] != BackupRunState.RUNNING.value:
        return
    started = state.get("started_at")
    if started is None:
        return
    try:
        started_dt = _as_aware(datetime.fromisoformat(started))
    except TypeError, ValueError:
        return
    if datetime.now().astimezone() - started_dt >= BACKUP_RUN_STALE_AFTER:
        write_backup_run_state(
            BackupRunState.FAILED,
            "The backup was interrupted before it finished",
        )


def _idle_backup_state() -> dict[str, Any]:
    return {
        "estado": BackupRunState.IDLE.value,
        "started_at": None,
        "finished_at": None,
        "error": None,
    }


def read_backup_run_state() -> dict[str, Any]:
    """Read the manual-backup progress from the state file."""
    path = backup_dir() / BACKUP_STATE_FILE
    try:
        data = json.loads(path.read_text())
    except OSError, ValueError:
        return _idle_backup_state()
    expected = set(_idle_backup_state())
    if not isinstance(data, dict) or not expected.issubset(data):
        return _idle_backup_state()
    if data.get("estado") not in {state.value for state in BackupRunState}:
        return _idle_backup_state()
    for key in ("started_at", "finished_at"):
        value = data.get(key)
        if value is not None:
            try:
                datetime.fromisoformat(value)
            except TypeError, ValueError:
                return _idle_backup_state()
    return data


def write_backup_run_state(
    estado: BackupRunState,
    error: str | None = None,
    *,
    started_at: datetime | None = None,
) -> None:
    previous = read_backup_run_state()
    state = {
        "estado": estado.value,
        "started_at": (
            started_at.isoformat() if started_at else previous.get("started_at")
        ),
        "finished_at": (
            datetime.now().astimezone().isoformat()
            if estado in (BackupRunState.SUCCESS, BackupRunState.FAILED)
            else None
        ),
        "error": error,
    }
    _write_json_atomic(backup_dir() / BACKUP_STATE_FILE, state)


@contextmanager
def backup_run_lock() -> Any:
    """Non-blocking lock so two run-now requests cannot start two dumps."""
    path = backup_dir() / BACKUP_STATE_FILE
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise BackupError("another backup is already running")
    try:
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def run_backup_worker(kind: BackupKind, user_id: uuid.UUID | None) -> None:
    """Synchronous backup body used by the detached manual-backup worker."""
    try:
        with Session(engine) as session:
            backup = create_backup(session, kind=kind, user_id=user_id)
            status = backup.status
            error = backup.error
            session.commit()
        if status == BackupStatus.SUCCESS:
            write_backup_run_state(BackupRunState.SUCCESS)
        else:
            write_backup_run_state(BackupRunState.FAILED, error=error)
            _notify_backup_failure(kind=kind.value, error=error or "Unknown error")
    except Exception as exc:
        logger.exception("background backup failed")
        error = _shorten(str(exc))
        write_backup_run_state(BackupRunState.FAILED, error=error)
        _notify_backup_failure(kind=kind.value, error=error)


def start_backup(kind: BackupKind, user_id: uuid.UUID | None) -> None:
    """Run the backup in a detached subprocess that survives API restarts."""
    subprocess.Popen(
        [
            sys.executable,
            "-m",
            "app.core.backup_worker",
            kind.value,
            str(user_id),
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
    now = system_now(session)
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
    try:
        backup = create_backup(session, kind=BackupKind.SCHEDULED, user_id=None)
        schedule.last_run_at = now
        schedule.last_status = backup.status
        schedule.last_error = backup.error
        if backup.status == BackupStatus.FAILED:
            _notify_backup_failure(
                kind=BackupKind.SCHEDULED.value, error=backup.error or "Unknown error"
            )
    except Exception as exc:
        # Advance the next run anyway so a failing dump is not retried every
        # scheduler tick (60s) while the problem persists.
        logger.exception("scheduled backup failed")
        error = _shorten(str(exc))
        schedule.last_run_at = now
        schedule.last_status = BackupStatus.FAILED
        schedule.last_error = error
        _notify_backup_failure(kind=BackupKind.SCHEDULED.value, error=error)
    schedule.next_run_at = compute_next_run(schedule, now)
    session.add(schedule)
    session.commit()
