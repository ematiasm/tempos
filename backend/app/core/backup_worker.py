"""Standalone manual-backup worker entry point.

Run detached from the API process via ``python -m app.core.backup_worker
<kind> <user_id>`` so a uvicorn restart (--reload, deploy) does not kill an
in-flight pg_dump. Progress is reported through the backup state file
(``backup.py``).
"""

import sys
import uuid

from app.core.backup import run_backup_worker
from app.models import BackupKind


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: python -m app.core.backup_worker <kind> [user_id]")
    kind = BackupKind(sys.argv[1])
    user_id_arg = sys.argv[2] if len(sys.argv) == 3 else None
    user_id = uuid.UUID(user_id_arg) if user_id_arg and user_id_arg != "None" else None
    run_backup_worker(kind, user_id)


if __name__ == "__main__":
    main()
