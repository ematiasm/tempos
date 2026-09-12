"""The seeded document types and the rule that resolves which row is the seed.

Two fields that could identify a seeded type — ``name`` and ``prefix`` — are both editable
from the admin panel, so neither can be an identity. The stable identity is ``key``, and this
module owns it.

A database created before ``key`` exists has no keys yet, which is why the resolution rule
lives here rather than in the seed loop: the old seed matched rows by ``prefix``, so renaming
a prefix made the next startup insert a duplicate of the seeded type. When both rows are
present, the one **in service** is the original — it is the row documents and numbering
sequences point at — and it is the one that must carry the key.

This module is pure data and pure functions: the Alembic migration imports it to backfill the
column, and ``app.core.db`` imports it to seed and repair. Nothing here opens a connection.
"""

from collections.abc import Iterable, Sequence
from typing import Any, NamedTuple, Protocol


class SeedIdentity(Protocol):
    """What the rule needs from a seed: its identity and the two editable fields.

    Read-only on purpose, so the frozen named tuples the migration and the seed define both
    satisfy it without either having to expose settable attributes.
    """

    @property
    def key(self) -> str: ...

    @property
    def name(self) -> str: ...

    @property
    def prefix(self) -> str: ...


class ResolvableRow(NamedTuple):
    """The fields the resolution rule needs from a ``DocumentType`` row."""

    id: Any
    name: str
    prefix: str
    # Referenced by a document or a numbering sequence: the row that has actually been used.
    in_service: bool


def resolve_seed_candidate(
    seed: SeedIdentity, rows: Iterable[ResolvableRow]
) -> ResolvableRow | None:
    """The row that should carry ``seed.key``, or ``None`` when no row claims it.

    A row claims a seed by its prefix or by its name. Among the candidates the order is: the
    row in service first, then an exact prefix match, then an exact name match, with the row
    id as the final tie-break so the outcome never depends on the order rows come back in.

    The row in service wins over the prefix on purpose. When a seed has vacated its prefix by
    a rename and a duplicate holds that prefix, the prefix points at the duplicate; only the
    service references point at the original.
    """
    candidates: Sequence[ResolvableRow] = [
        row for row in rows if row.prefix == seed.prefix or row.name == seed.name
    ]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda row: (
            not row.in_service,
            row.prefix != seed.prefix,
            row.name != seed.name,
            str(row.id),
        ),
    )
