"""Standalone restore worker entry point.

Run detached from the API process via ``python -m app.core.restore_worker
<source_path> <source_filename>`` so a uvicorn restart (--reload, deploy) does
not kill an in-flight database restore. Progress is reported through the
restore state file (``backup.py``), never the database: the database itself
is dropped while the restore runs.
"""

import sys
from pathlib import Path

from app.core.backup import restore_database


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(
            "usage: python -m app.core.restore_worker <source_path> <filename>"
        )
    source_path = Path(sys.argv[1])
    source_filename = sys.argv[2]
    restore_database(source_path, source_filename)


if __name__ == "__main__":
    main()
