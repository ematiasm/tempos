"""Tests for the rule that decides which row carries a seeded document type.

A database created before `DocumentType.key` exists has no keys yet, and both fields that
could identify a seeded type — `name` and `prefix` — are editable from the admin panel. The
old seed matched rows by `prefix`, so renaming a prefix made the next startup insert a
duplicate. When both rows are present, the one **in service** is the original: it is the row
documents and numbering sequences point at. Preferring it is what keeps a key off the
duplicate.
"""

from typing import NamedTuple

from app.core.document_type_seed import ResolvableRow, resolve_seed_candidate


class _Seed(NamedTuple):
    """The rule reads a seed's identity and its two editable fields, nothing else."""

    key: str
    name: str
    prefix: str


FA = _Seed(key="factura_a", name="Factura A", prefix="FA")


def test_prefers_the_row_in_service_over_the_duplicate() -> None:
    # The exact shape the old seed left behind: the original was renamed to FAX and still
    # serves every historical sale, while a duplicate holds the FA prefix and serves nothing.
    original = ResolvableRow("a", "Factura A", "FAX", True)
    duplicate = ResolvableRow("b", "Factura A", "FA", False)

    assert resolve_seed_candidate(FA, [duplicate, original]) is original


def test_falls_back_to_the_prefix_when_nothing_is_in_service() -> None:
    # A fresh database that was renamed but never used: the prefix is the only signal left.
    duplicate = ResolvableRow("b", "Factura A", "FA", False)
    renamed = ResolvableRow("a", "Comprobante", "XX", False)

    assert resolve_seed_candidate(FA, [renamed, duplicate]) is duplicate


def test_prefers_the_prefix_over_a_name_only_match() -> None:
    seed = FA
    name_only = ResolvableRow("a", "Factura A", "XX", False)
    prefix_match = ResolvableRow("b", "Renamed", "FA", False)

    assert resolve_seed_candidate(seed, [name_only, prefix_match]) is prefix_match


def test_ignores_rows_that_claim_nothing_and_answers_none() -> None:
    seed = FA

    assert (
        resolve_seed_candidate(seed, [ResolvableRow("a", "Ticket", "TCK", False)])
        is None
    )
    assert resolve_seed_candidate(seed, []) is None


def test_the_outcome_is_deterministic_on_a_tie() -> None:
    # Two rows with the same name, the same prefix and the same service state: the id breaks
    # the tie so the migration cannot depend on the order Postgres returns rows in.
    first = ResolvableRow("a", "Factura A", "FA", False)
    second = ResolvableRow("b", "Factura A", "FA", False)

    assert resolve_seed_candidate(FA, [second, first]) is first
    assert resolve_seed_candidate(FA, [first, second]) is first


def test_a_row_in_service_beats_a_prefix_match() -> None:
    # The renamed original holds a prefix no seed expects; service still identifies it.
    seed = FA
    in_service = ResolvableRow("a", "Factura A", "ZZZ", True)
    prefix_match = ResolvableRow("b", "Factura A", "FA", False)

    assert resolve_seed_candidate(seed, [prefix_match, in_service]) is in_service
