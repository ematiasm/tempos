"""Tests for the backups module (schedule, run, list, download, restore).

All pg_* subprocess calls are mocked: tests never dump or restore the real
database.
"""

import io
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core import backup as backup_service
from app.core.config import settings
from app.models import (
    Backup,
    BackupFrequency,
    BackupSchedule,
    BackupStatus,
    RestoreState,
)

PAST = datetime(2020, 1, 1, 0, 0, 0).astimezone()
FAR_FUTURE = datetime(2999, 1, 1, 0, 0, 0).astimezone()


@pytest.fixture(autouse=True)
def _backup_dir(tmp_path, monkeypatch):
    """Point BACKUP_DIR at a temp dir and mock every pg_* subprocess call."""
    monkeypatch.setattr(settings, "BACKUP_DIR", str(tmp_path))

    def fake_run_command(args: list[str]) -> str:
        # Materialize the dump file so download/restore paths work end to end.
        if args and "pg_dump" in args[0]:
            target = args[args.index("-f") + 1]
            with open(target, "wb") as fh:
                fh.write(b"fake dump")
        return ""

    monkeypatch.setattr(backup_service, "run_command", fake_run_command)
    return tmp_path


@pytest.fixture(autouse=True)
def _preserve_schedule(db: Session):
    """Restore the shared schedule row after each test (it is baseline data)."""
    db.expire_all()
    row = db.get(BackupSchedule, 1)
    if row is None:
        yield
        return
    snapshot = {
        "enabled": row.enabled,
        "frequency": row.frequency,
        "run_time": row.run_time,
        "day_of_week": row.day_of_week,
        "day_of_month": row.day_of_month,
        "retention": row.retention,
    }
    yield
    db.expire_all()
    row = db.get(BackupSchedule, 1)
    if row is None:
        return
    for key, value in snapshot.items():
        setattr(row, key, value)
    db.commit()


def _create_backup(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(f"{settings.API_V1_STR}/backups/run-now", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _schedule(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.get(f"{settings.API_V1_STR}/backups/schedule", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _reset_schedule(client: TestClient, headers: dict[str, str]) -> None:
    """Put the schedule back to the seed defaults (shared-DB independence)."""
    r = client.put(
        f"{settings.API_V1_STR}/backups/schedule",
        headers=headers,
        json={
            "enabled": True,
            "frequency": "daily",
            "run_time": "03:00",
            "retention": 14,
            "day_of_week": None,
            "day_of_month": None,
        },
    )
    assert r.status_code == 200, r.text


def test_schedule_get_creates_default(client: TestClient, superuser_token_headers):
    # The shared DB may carry state from previous runs; reset to the seed
    # defaults first so the assertions do not depend on leftovers.
    _reset_schedule(client, superuser_token_headers)
    schedule = _schedule(client, superuser_token_headers)
    assert schedule["enabled"] is True
    assert schedule["frequency"] == "daily"
    assert schedule["run_time"] == "03:00"
    assert schedule["retention"] == 14
    assert schedule["next_run_at"] is not None


def test_schedule_update_daily(
    client: TestClient, superuser_token_headers, db: Session
):
    headers = superuser_token_headers
    _schedule(client, headers)
    r = client.put(
        f"{settings.API_V1_STR}/backups/schedule",
        headers=headers,
        json={
            "frequency": "daily",
            "run_time": "05:30",
            "retention": 7,
            "day_of_week": 2,
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["frequency"] == "daily"
    assert data["run_time"] == "05:30"
    assert data["retention"] == 7
    assert data["day_of_week"] is None
    assert data["day_of_month"] is None

    db.expire_all()
    row = db.get(BackupSchedule, 1)
    assert row is not None
    assert row.next_run_at is not None
    assert row.next_run_at.astimezone().strftime("%H:%M") == "05:30"


def test_schedule_update_weekly_requires_day(
    client: TestClient, superuser_token_headers
):
    _reset_schedule(client, superuser_token_headers)
    r = client.put(
        f"{settings.API_V1_STR}/backups/schedule",
        headers=superuser_token_headers,
        json={"frequency": "weekly"},
    )
    assert r.status_code == 422


def test_schedule_update_monthly_requires_day(
    client: TestClient, superuser_token_headers
):
    _reset_schedule(client, superuser_token_headers)
    r = client.put(
        f"{settings.API_V1_STR}/backups/schedule",
        headers=superuser_token_headers,
        json={"frequency": "monthly"},
    )
    assert r.status_code == 422


def test_schedule_update_invalid_time(client: TestClient, superuser_token_headers):
    r = client.put(
        f"{settings.API_V1_STR}/backups/schedule",
        headers=superuser_token_headers,
        json={"run_time": "25:99"},
    )
    assert r.status_code == 422


def test_schedule_update_weekly_ok(client: TestClient, superuser_token_headers):
    r = client.put(
        f"{settings.API_V1_STR}/backups/schedule",
        headers=superuser_token_headers,
        json={"frequency": "weekly", "day_of_week": 0},
    )
    assert r.status_code == 200, r.text
    assert r.json()["day_of_week"] == 0


def test_run_now_creates_backup(
    client: TestClient, superuser_token_headers, _backup_dir
):
    backup = _create_backup(client, superuser_token_headers)
    assert backup["status"] == "success"
    assert backup["size_bytes"] > 0
    assert backup["filename"].endswith(".dump")
    assert backup["created_by_name"] == settings.FIRST_SUPERUSER
    path = _backup_dir / backup["filename"]
    assert path.is_file()

    r = client.get(f"{settings.API_V1_STR}/backups/", headers=superuser_token_headers)
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 1
    assert r.json()["data"][0]["id"] == backup["id"]


def test_run_now_records_failure(
    client: TestClient, superuser_token_headers, monkeypatch, _backup_dir
):
    def boom(_args: list[str]) -> str:
        raise backup_service.BackupError("pg_dump exploded")

    monkeypatch.setattr(backup_service, "run_command", boom)
    backup = _create_backup(client, superuser_token_headers)
    assert backup["status"] == "failed"
    assert "pg_dump exploded" in backup["error"]
    assert not (_backup_dir / backup["filename"]).exists()


def test_retention_prunes_old_backups(
    client: TestClient, superuser_token_headers, db: Session, _backup_dir
):
    headers = superuser_token_headers
    first = _create_backup(client, headers)
    second = _create_backup(client, headers)

    r = client.put(
        f"{settings.API_V1_STR}/backups/schedule",
        headers=headers,
        json={"retention": 1},
    )
    assert r.status_code == 200, r.text

    third = _create_backup(client, headers)
    r = client.get(f"{settings.API_V1_STR}/backups/", headers=headers)
    assert r.status_code == 200
    ids = [b["id"] for b in r.json()["data"]]
    assert ids == [third["id"]]
    assert not (_backup_dir / first["filename"]).exists()
    assert not (_backup_dir / second["filename"]).exists()
    assert (_backup_dir / third["filename"]).exists()
    db.expire_all()
    remaining = db.exec(select(Backup)).all()
    assert [str(b.id) for b in remaining] == [third["id"]]


def test_download_backup(client: TestClient, superuser_token_headers, _backup_dir):
    backup = _create_backup(client, superuser_token_headers)
    r = client.get(
        f"{settings.API_V1_STR}/backups/{backup['id']}/download",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.content == b"fake dump"


def test_download_missing_backup(client: TestClient, superuser_token_headers):
    r = client.get(
        f"{settings.API_V1_STR}/backups/00000000-0000-0000-0000-000000000000/download",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404


def test_delete_backup(client: TestClient, superuser_token_headers, _backup_dir):
    backup = _create_backup(client, superuser_token_headers)
    r = client.delete(
        f"{settings.API_V1_STR}/backups/{backup['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 204
    assert not (_backup_dir / backup["filename"]).exists()

    r = client.get(f"{settings.API_V1_STR}/backups/", headers=superuser_token_headers)
    assert r.json()["count"] == 0


def test_restore_requires_source(client: TestClient, superuser_token_headers):
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
    )
    assert r.status_code == 400


def test_restore_upload_runs_background(
    client: TestClient,
    superuser_token_headers,
    _backup_dir,
    _restore_runs_sync,
):
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        files={
            "file": ("dump.dump", io.BytesIO(b"fake dump"), "application/octet-stream")
        },
    )
    assert r.status_code == 202, r.text
    # The worker runs synchronously in tests, so the state is final on return.
    assert r.json()["estado"] == "success"

    r = client.get(
        f"{settings.API_V1_STR}/backups/restore-status",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["estado"] == "success"
    assert r.json()["source_filename"] == "dump.dump"
    # The uploaded temp file is cleaned up after the restore.
    leftovers = [
        p for p in _backup_dir.iterdir() if p.name.startswith("restore_upload_")
    ]
    assert leftovers == []


def test_restore_from_backup_id(
    client: TestClient, superuser_token_headers, _backup_dir, _restore_runs_sync
):
    backup = _create_backup(client, superuser_token_headers)
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        data={"backup_id": backup["id"]},
        files={},
    )
    assert r.status_code == 202, r.text
    r = client.get(
        f"{settings.API_V1_STR}/backups/restore-status",
        headers=superuser_token_headers,
    )
    assert r.json()["estado"] == "success"
    assert r.json()["source_filename"] == backup["filename"]


@pytest.fixture
def _restore_running(_backup_dir):
    """Force the restore state file to RUNNING, restoring the prior state."""
    path = _backup_dir / backup_service.RESTORE_STATE_FILE
    previous = path.read_text() if path.exists() else None
    backup_service.write_restore_state(RestoreState.RUNNING)
    yield
    if previous is None:
        path.unlink(missing_ok=True)
    else:
        path.write_text(previous)


@pytest.fixture
def _restore_runs_sync(monkeypatch):
    """Run the restore synchronously instead of via a detached subprocess."""

    def fake_start(source_path, source_filename):
        backup_service.restore_database(source_path, source_filename)

    monkeypatch.setattr(backup_service, "start_restore", fake_start)


def test_restore_conflict_when_running(
    client: TestClient, superuser_token_headers, _restore_running
):
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        files={"file": ("dump.dump", io.BytesIO(b"data"), "application/octet-stream")},
    )
    assert r.status_code == 409


def test_run_now_conflict_while_restoring(
    client: TestClient, superuser_token_headers, _restore_running
):
    r = client.post(
        f"{settings.API_V1_STR}/backups/run-now", headers=superuser_token_headers
    )
    assert r.status_code == 409


def test_stale_restore_is_recovered(
    client: TestClient, superuser_token_headers, _backup_dir
):
    # A RUNNING state older than the staleness threshold blocks the module
    # until recovered; create_backup_now must recover it first.
    backup_service.write_restore_state(
        RestoreState.RUNNING,
        started_at=datetime.now().astimezone() - timedelta(hours=1),
    )

    backup = _create_backup(client, superuser_token_headers)
    assert backup["status"] == "success"

    state = backup_service.read_restore_state()
    assert state["estado"] == RestoreState.FAILED.value


def test_restore_passes_connection_args(
    client: TestClient,
    superuser_token_headers,
    monkeypatch,
    _backup_dir,
    _restore_runs_sync,
):
    """pg_restore must reach the database via the same args as psql."""
    calls: list[list[str]] = []

    def capture(args: list[str]) -> str:
        calls.append(args)
        return ""

    monkeypatch.setattr(backup_service, "run_command", capture)
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        files={"file": ("dump.dump", io.BytesIO(b"data"), "application/octet-stream")},
    )
    assert r.status_code == 202, r.text

    pg_restore_call = next(call for call in calls if "pg_restore" in call[0])
    assert "-h" in pg_restore_call
    assert "-p" in pg_restore_call
    assert "-U" in pg_restore_call

    state = backup_service.read_restore_state()
    assert state["estado"] == RestoreState.SUCCESS.value


def test_restore_failure_is_recorded(
    client: TestClient, superuser_token_headers, monkeypatch, _restore_runs_sync
):
    def boom(_args: list[str]) -> str:
        raise backup_service.BackupError("restore exploded")

    monkeypatch.setattr(backup_service, "run_command", boom)
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        files={"file": ("dump.dump", io.BytesIO(b"data"), "application/octet-stream")},
    )
    assert r.status_code == 202
    assert r.json()["estado"] == "failed"
    assert "restore exploded" in r.json()["error"]


def test_restore_rejects_empty_upload(client: TestClient, superuser_token_headers):
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        files={"file": ("empty.dump", io.BytesIO(b""), "application/octet-stream")},
    )
    assert r.status_code == 400


def test_permissions_required(client: TestClient, normal_user_token_headers):
    # The normal (non-superuser) test user has no backup permissions.
    r = client.get(f"{settings.API_V1_STR}/backups/", headers=normal_user_token_headers)
    assert r.status_code == 403


def test_compute_next_run_daily():
    schedule = BackupSchedule(
        frequency=BackupFrequency.DAILY,
        run_time="03:00",
        day_of_week=None,
        day_of_month=None,
    )
    now = datetime(2026, 8, 8, 10, 0, 0)
    next_run = backup_service.compute_next_run(schedule, now=now)
    assert next_run == datetime(2026, 8, 9, 3, 0, 0)


def test_compute_next_run_daily_same_day_later():
    schedule = BackupSchedule(
        frequency=BackupFrequency.DAILY,
        run_time="03:00",
        day_of_week=None,
        day_of_month=None,
    )
    now = datetime(2026, 8, 8, 1, 0, 0)
    next_run = backup_service.compute_next_run(schedule, now=now)
    assert next_run == datetime(2026, 8, 8, 3, 0, 0)


def test_compute_next_run_weekly():
    schedule = BackupSchedule(
        frequency=BackupFrequency.WEEKLY,
        run_time="03:00",
        day_of_week=0,
        day_of_month=None,
    )
    # Saturday 2026-08-08 -> next Monday 2026-08-10.
    now = datetime(2026, 8, 8, 10, 0, 0)
    next_run = backup_service.compute_next_run(schedule, now=now)
    assert next_run == datetime(2026, 8, 10, 3, 0, 0)


def test_compute_next_run_weekly_same_day():
    schedule = BackupSchedule(
        frequency=BackupFrequency.WEEKLY,
        run_time="03:00",
        day_of_week=0,
        day_of_month=None,
    )
    # Monday 2026-08-10 at 02:00 -> Monday 03:00 the same day.
    now = datetime(2026, 8, 10, 2, 0, 0)
    next_run = backup_service.compute_next_run(schedule, now=now)
    assert next_run == datetime(2026, 8, 10, 3, 0, 0)


def test_compute_next_run_monthly():
    schedule = BackupSchedule(
        frequency=BackupFrequency.MONTHLY,
        run_time="03:00",
        day_of_week=None,
        day_of_month=15,
    )
    now = datetime(2026, 8, 8, 10, 0, 0)
    next_run = backup_service.compute_next_run(schedule, now=now)
    assert next_run == datetime(2026, 8, 15, 3, 0, 0)


def test_compute_next_run_monthly_short_month():
    schedule = BackupSchedule(
        frequency=BackupFrequency.MONTHLY,
        run_time="03:00",
        day_of_week=None,
        day_of_month=31,
    )
    # April has 30 days -> clamped to the last day of April.
    now = datetime(2026, 4, 1, 10, 0, 0)
    next_run = backup_service.compute_next_run(schedule, now=now)
    assert next_run == datetime(2026, 4, 30, 3, 0, 0)


def test_scheduled_tick_runs_when_due(
    client: TestClient, superuser_token_headers, db: Session, _backup_dir
):
    _schedule(client, superuser_token_headers)
    db.expire_all()
    schedule = db.get(BackupSchedule, 1)
    assert schedule is not None
    schedule.enabled = True
    schedule.next_run_at = PAST
    db.commit()

    backup_service.run_scheduled_backups()

    db.expire_all()
    backup = db.exec(select(Backup)).first()
    assert backup is not None
    assert backup.kind == "scheduled"
    assert backup.created_by_id is None
    schedule = db.get(BackupSchedule, 1)
    assert schedule is not None
    assert schedule.last_status == BackupStatus.SUCCESS
    assert schedule.next_run_at is not None and schedule.next_run_at > PAST


def test_scheduled_tick_skips_when_not_due(
    client: TestClient, superuser_token_headers, db: Session
):
    _schedule(client, superuser_token_headers)
    db.expire_all()
    schedule = db.get(BackupSchedule, 1)
    assert schedule is not None
    schedule.enabled = True
    schedule.next_run_at = FAR_FUTURE
    db.commit()

    backup_service.run_scheduled_backups()

    db.expire_all()
    assert db.exec(select(Backup)).all() == []
