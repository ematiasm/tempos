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
    BackupKind,
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
        # The restore worker checks the restored alembic_version and then
        # runs alembic upgrade head; both go through run_command.
        if any("alembic_version" in arg for arg in args):
            return "37543f24f0f0"
        return ""

    monkeypatch.setattr(backup_service, "run_command", fake_run_command)
    return tmp_path


@pytest.fixture(autouse=True)
def _backup_runs_sync(monkeypatch):
    """Run manual backups synchronously instead of via a detached subprocess."""

    def fake_start(kind, user_id):
        backup_service.run_backup_worker(kind, user_id)

    monkeypatch.setattr(backup_service, "start_backup", fake_start)


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
    """Run a manual backup (202) and return the newest backup row."""
    r = client.post(f"{settings.API_V1_STR}/backups/run-now", headers=headers)
    assert r.status_code == 202, r.text
    assert r.json()["estado"] in ("running", "success")
    state = client.get(
        f"{settings.API_V1_STR}/backups/run-status", headers=headers
    ).json()
    assert state["estado"] == "success", state
    r = client.get(f"{settings.API_V1_STR}/backups/", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data, "expected at least one backup row"
    return data[0]


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
    me = client.get(
        f"{settings.API_V1_STR}/users/me", headers=superuser_token_headers
    ).json()
    assert backup["created_by_id"] == me["id"]
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
    r = client.post(
        f"{settings.API_V1_STR}/backups/run-now", headers=superuser_token_headers
    )
    assert r.status_code == 202, r.text
    state = client.get(
        f"{settings.API_V1_STR}/backups/run-status", headers=superuser_token_headers
    ).json()
    assert state["estado"] == "failed"
    assert "pg_dump exploded" in state["error"]
    backup = client.get(
        f"{settings.API_V1_STR}/backups/", headers=superuser_token_headers
    ).json()["data"][0]
    assert backup["status"] == "failed"
    assert "pg_dump exploded" in backup["error"]
    assert not (_backup_dir / backup["filename"]).exists()


def test_backup_failure_notifies_superusers(
    client: TestClient, superuser_token_headers, monkeypatch, _backup_dir
):
    """A failed manual backup triggers the email alert dispatcher."""
    notified: list[dict] = []
    monkeypatch.setattr(
        backup_service,
        "_notify_backup_failure",
        lambda **kwargs: notified.append(kwargs),
    )

    def boom(_args: list[str]) -> str:
        raise backup_service.BackupError("pg_dump exploded")

    monkeypatch.setattr(backup_service, "run_command", boom)
    r = client.post(
        f"{settings.API_V1_STR}/backups/run-now", headers=superuser_token_headers
    )
    assert r.status_code == 202, r.text
    assert any(n.get("kind") == "manual" for n in notified)
    assert any("pg_dump exploded" in n.get("error", "") for n in notified)


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


@pytest.fixture
def _restore_noop(monkeypatch):
    """Leave the restore running (no worker) so a second POST can be tested."""

    monkeypatch.setattr(backup_service, "start_restore", lambda *a, **k: None)


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
    """pg_restore must reach the database via the same args as psql, abort on
    error, and the restore must migrate the schema to the current head."""
    calls: list[list[str]] = []

    def capture(args: list[str]) -> str:
        calls.append(args)
        if any("alembic_version" in arg for arg in args):
            return "37543f24f0f0"
        return ""

    monkeypatch.setattr(backup_service, "run_command", capture)
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        files={"file": ("dump.dump", io.BytesIO(b"data"), "application/octet-stream")},
    )
    assert r.status_code == 202, r.text

    pg_restore_call = next(
        call for call in calls if "pg_restore" in call[0] and "-l" not in call
    )
    assert "-h" in pg_restore_call
    assert "-p" in pg_restore_call
    assert "-U" in pg_restore_call
    assert "--exit-on-error" in pg_restore_call
    assert any(call == ["alembic", "upgrade", "head"] for call in calls)

    state = backup_service.read_restore_state()
    assert state["estado"] == RestoreState.SUCCESS.value


def test_restore_fails_without_alembic_version(
    client: TestClient, superuser_token_headers, monkeypatch, _restore_runs_sync
):
    """A dump without alembic bookkeeping must not be reported as success."""
    monkeypatch.setattr(backup_service, "run_command", lambda _args: "")
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        files={"file": ("dump.dump", io.BytesIO(b"data"), "application/octet-stream")},
    )
    assert r.status_code == 202, r.text
    state = backup_service.read_restore_state()
    assert state["estado"] == RestoreState.FAILED.value
    assert "alembic_version" in state["error"]


def test_restore_failure_is_recorded(
    client: TestClient, superuser_token_headers, monkeypatch, _restore_runs_sync
):
    def boom(args: list[str]) -> str:
        if "pg_restore" in args[0] and "-l" not in args:
            raise backup_service.BackupError("restore exploded")
        if any("alembic_version" in arg for arg in args):
            return "37543f24f0f0"
        return ""

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


def test_restore_rejects_invalid_upload(
    client: TestClient, superuser_token_headers, monkeypatch
):
    def boom(args: list[str]) -> str:
        if "pg_restore" in args[0] and "-l" in args:
            raise backup_service.BackupError("not a dump")
        return ""

    monkeypatch.setattr(backup_service, "run_command", boom)
    r = client.post(
        f"{settings.API_V1_STR}/backups/restore",
        headers=superuser_token_headers,
        files={"file": ("bad.dump", io.BytesIO(b"junk"), "application/octet-stream")},
    )
    assert r.status_code == 400
    leftovers = [
        p
        for p in backup_service.backup_dir().iterdir()
        if p.name.startswith("restore_upload_")
    ]
    assert leftovers == []


def test_restore_second_post_conflicts(
    client: TestClient, superuser_token_headers, _restore_noop
):
    """Two concurrent restore requests must not both spawn a worker."""
    for _ in range(2):
        r = client.post(
            f"{settings.API_V1_STR}/backups/restore",
            headers=superuser_token_headers,
            files={
                "file": ("dump.dump", io.BytesIO(b"data"), "application/octet-stream")
            },
        )
    assert r.status_code == 409


def test_run_now_conflict_when_backup_running(
    client: TestClient, superuser_token_headers, _backup_dir
):
    backup_service.write_backup_run_state(backup_service.BackupRunState.RUNNING)
    r = client.post(
        f"{settings.API_V1_STR}/backups/run-now", headers=superuser_token_headers
    )
    assert r.status_code == 409


def test_stale_backup_run_is_recovered(
    client: TestClient, superuser_token_headers, _backup_dir
):
    backup_service.write_backup_run_state(
        backup_service.BackupRunState.RUNNING,
        started_at=datetime.now().astimezone() - timedelta(hours=1),
    )
    state = client.get(
        f"{settings.API_V1_STR}/backups/run-status", headers=superuser_token_headers
    ).json()
    assert state["estado"] == "failed"


def test_prune_removes_orphan_rows(
    client: TestClient, superuser_token_headers, db: Session, _backup_dir
):
    """Rows whose dump file is gone (stale references) are pruned, while
    FAILED rows stay as an error record."""
    db.add(
        Backup(
            filename="ghost.dump",
            size_bytes=123,
            kind=BackupKind.MANUAL,
            status=BackupStatus.SUCCESS,
        )
    )
    db.add(
        Backup(
            filename="failed.dump",
            size_bytes=0,
            kind=BackupKind.MANUAL,
            status=BackupStatus.FAILED,
            error="boom",
        )
    )
    db.commit()
    _create_backup(client, superuser_token_headers)
    db.expire_all()
    remaining = db.exec(select(Backup)).all()
    assert not any(b.filename == "ghost.dump" for b in remaining)
    assert any(b.filename == "failed.dump" for b in remaining)


def test_sync_imports_orphan_dump_files(
    client: TestClient, superuser_token_headers, _backup_dir
):
    """Dumps present on disk without a Backup row are surfaced by the list."""
    (_backup_dir / "tempos_backup_20260101_120000_aabbccdd.dump").write_bytes(
        b"fake dump"
    )
    r = client.get(f"{settings.API_V1_STR}/backups/", headers=superuser_token_headers)
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 1
    row = r.json()["data"][0]
    assert row["filename"] == "tempos_backup_20260101_120000_aabbccdd.dump"
    assert row["kind"] == "manual"
    assert row["status"] == "success"
    assert row["created_by_id"] is None
    assert row["created_by_name"] is None
    # The embedded timestamp is parsed into the row's creation time.
    assert row["created_at"] is not None
    assert (_backup_dir / row["filename"]).is_file()


def test_sync_is_idempotent(client: TestClient, superuser_token_headers, _backup_dir):
    """Repeated listings must not duplicate imported backups."""
    (_backup_dir / "tempos_backup_20260101_120000_aabbccdd.dump").write_bytes(
        b"fake dump"
    )
    headers = superuser_token_headers
    first = client.get(f"{settings.API_V1_STR}/backups/", headers=headers)
    second = client.get(f"{settings.API_V1_STR}/backups/", headers=headers)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["count"] == 1
    assert second.json()["count"] == 1
    assert first.json()["data"][0]["id"] == second.json()["data"][0]["id"]


def test_sync_skips_restore_uploads(
    client: TestClient, superuser_token_headers, _backup_dir
):
    """Temp files left behind by a restore upload are not imported."""
    (_backup_dir / "restore_upload_abcdef01.dump").write_bytes(b"fake dump")
    r = client.get(f"{settings.API_V1_STR}/backups/", headers=superuser_token_headers)
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 0


def test_sync_falls_back_to_mtime(
    client: TestClient, superuser_token_headers, _backup_dir
):
    """Files whose name does not follow the dump pattern use file mtime."""
    path = _backup_dir / "odd_name.dump"
    path.write_bytes(b"fake dump")
    import os

    os.utime(path, (1700000000, 1700000000))
    r = client.get(f"{settings.API_V1_STR}/backups/", headers=superuser_token_headers)
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 1
    row = r.json()["data"][0]
    assert row["filename"] == "odd_name.dump"
    assert row["created_at"] is not None


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


def test_scheduled_tick_advances_on_failure(
    client: TestClient, superuser_token_headers, db: Session, monkeypatch
):
    """A failing scheduled dump advances next_run_at instead of retrying every tick."""
    _schedule(client, superuser_token_headers)
    db.expire_all()
    schedule = db.get(BackupSchedule, 1)
    assert schedule is not None
    schedule.enabled = True
    schedule.next_run_at = PAST
    db.commit()

    notified: list[dict] = []
    monkeypatch.setattr(
        backup_service,
        "_notify_backup_failure",
        lambda **kwargs: notified.append(kwargs),
    )

    def boom(_args: list[str]) -> str:
        raise backup_service.BackupError("pg_dump exploded")

    monkeypatch.setattr(backup_service, "run_command", boom)
    backup_service.run_scheduled_backups()

    db.expire_all()
    schedule = db.get(BackupSchedule, 1)
    assert schedule is not None
    assert schedule.last_status == BackupStatus.FAILED
    assert "pg_dump exploded" in (schedule.last_error or "")
    assert schedule.next_run_at is not None and schedule.next_run_at > PAST
    assert any(n.get("kind") == "scheduled" for n in notified)
