"""Tests for the /document-types endpoints."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import init_db
from app.models import (
    CounterpartType,
    DocumentOperation,
    DocumentSequence,
    DocumentType,
)
from tests.utils.utils import random_lower_string


def _types(client: TestClient, headers: dict[str, str]) -> list[dict]:
    r = client.get(
        f"{settings.API_V1_STR}/document-types/",
        headers=headers,
        params={"limit": 100},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _type_by_prefix(client: TestClient, headers: dict[str, str], prefix: str) -> dict:
    return next(row for row in _types(client, headers) if row["prefix"] == prefix)


def test_seeded_document_types(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/document-types/",
        headers=superuser_token_headers,
        params={"limit": 100},
    )
    assert r.status_code == 200
    rows = {row["prefix"]: row for row in r.json()["data"]}
    assert len(rows) == 14
    # Spot-check the locked seed table
    assert rows["FA"]["name"] == "Factura A"
    assert rows["FA"]["signo_stock"] == -1
    assert rows["FA"]["signo_caja"] == 1
    assert rows["FA"]["es_fiscal"] is True
    assert rows["FA"]["tipo_contraparte"] == "customer"
    assert rows["OC"]["operation"] == "compra"
    assert rows["OC"]["signo_stock"] == 1
    assert rows["COT"]["signo_stock"] == 0
    assert rows["NCV"]["signo_stock"] == 1
    assert rows["NCV"]["signo_caja"] == -1
    assert rows["AJS"]["tipo_contraparte"] is None
    assert rows["RTO"]["signo_caja"] == 0
    assert rows["RC"]["operation"] == "recibo"
    assert rows["RC"]["signo_caja"] == 1
    assert rows["RC"]["tipo_contraparte"] == "customer"
    assert rows["RP"]["signo_caja"] == -1
    assert rows["RP"]["tipo_contraparte"] == "supplier"
    # The stable seed identity, checked for every row because Alembic autogenerate
    # cannot see an enum or a seed change and `alembic check` would stay silent.
    assert {prefix: row["key"] for prefix, row in rows.items()} == {
        "FA": "factura_a",
        "FB": "factura_b",
        "FC": "factura_c",
        "TCK": "ticket",
        "COT": "cotizacion",
        "NCV": "nota_credito_venta",
        "NDV": "nota_debito_venta",
        "OC": "orden_compra",
        "NCC": "nc_compra",
        "NDC": "nd_compra",
        "RTO": "remito",
        "AJS": "ajuste_stock",
        "RC": "recibo_cobro",
        "RP": "recibo_pago",
    }
    # The void mirrors are wired by `key` now, so a mis-keyed entry would silently
    # leave a type un-voidable instead of failing loudly.
    assert rows["FA"]["void_document_type_id"] == rows["NCV"]["id"]
    assert rows["TCK"]["void_document_type_id"] == rows["NCV"]["id"]
    assert rows["OC"]["void_document_type_id"] == rows["NCC"]["id"]
    assert rows["NDC"]["void_document_type_id"] == rows["NCC"]["id"]
    assert rows["AJS"]["void_document_type_id"] is None
    assert rows["COT"]["void_document_type_id"] is None


def test_update_document_type_name_and_prefix(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/document-types/",
        headers=superuser_token_headers,
        params={"limit": 100},
    )
    fa = next(row for row in r.json()["data"] if row["prefix"] == "FA")

    r = client.patch(
        f"{settings.API_V1_STR}/document-types/{fa['id']}",
        headers=superuser_token_headers,
        json={"prefix": "FAX", "name": "Factura A (test)"},
    )
    assert r.status_code == 200
    assert r.json()["prefix"] == "FAX"
    assert r.json()["name"] == "Factura A (test)"

    # another type cannot reuse the prefix
    fb = next(
        row
        for row in client.get(
            f"{settings.API_V1_STR}/document-types/",
            headers=superuser_token_headers,
            params={"limit": 100},
        ).json()["data"]
        if row["prefix"] == "FBX" or row["name"] == "Factura B"
    )
    r = client.patch(
        f"{settings.API_V1_STR}/document-types/{fb['id']}",
        headers=superuser_token_headers,
        json={"prefix": "FAX"},
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]

    # restore seeded values so later phases keep their assumptions
    r = client.patch(
        f"{settings.API_V1_STR}/document-types/{fa['id']}",
        headers=superuser_token_headers,
        json={"prefix": "FA", "name": "Factura A"},
    )
    assert r.status_code == 200


def test_fiscal_type_survives_a_rename(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """A renamed fiscal type is still the one the tax condition resolves to.

    `name` and `prefix` are both editable from the admin panel, so resolving a seeded
    type by either turns a supported edit into a broken sale screen: the suggestion
    used to look the row up by `name == "Factura A"` and raised
    `Seeded document type 'Factura A' not found` the moment a user renamed it.
    """
    fa = _type_by_prefix(client, superuser_token_headers, "FA")
    settings_url = f"{settings.API_V1_STR}/business-settings/"
    original_condicion = client.get(
        settings_url, headers=superuser_token_headers
    ).json()["condicion_fiscal"]
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=superuser_token_headers,
        json={
            "razon_social": random_lower_string()[:20],
            "condicion_fiscal": "RI",
        },
    )
    assert r.status_code == 200, r.text
    customer = r.json()
    client.patch(
        settings_url,
        headers=superuser_token_headers,
        json={"condicion_fiscal": "RI"},
    )

    try:
        r = client.patch(
            f"{settings.API_V1_STR}/document-types/{fa['id']}",
            headers=superuser_token_headers,
            json={"prefix": "FAX", "name": "Factura A (renamed)"},
        )
        assert r.status_code == 200, r.text

        r = client.get(
            f"{settings.API_V1_STR}/documents/suggest-type",
            headers=superuser_token_headers,
            params={"customer_id": customer["id"]},
        )
        assert r.status_code == 200, r.text
        assert r.json()["id"] == fa["id"]
        assert r.json()["name"] == "Factura A (renamed)"
    finally:
        client.patch(
            f"{settings.API_V1_STR}/document-types/{fa['id']}",
            headers=superuser_token_headers,
            json={"prefix": "FA", "name": "Factura A"},
        )
        client.patch(
            settings_url,
            headers=superuser_token_headers,
            json={"condicion_fiscal": original_condicion},
        )


def test_reseed_does_not_duplicate_a_renamed_type(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Re-running the seed after a prefix edit must not insert a second row.

    The seed matches existing types by `prefix`, so renaming one makes the next
    startup believe the type is missing and insert a duplicate of it.
    """
    fa = _type_by_prefix(client, superuser_token_headers, "FA")
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/document-types/{fa['id']}",
            headers=superuser_token_headers,
            json={"prefix": "FAX"},
        )
        assert r.status_code == 200, r.text
        assert len(_types(client, superuser_token_headers)) == 14

        init_db(db)

        rows = _types(client, superuser_token_headers)
        assert len(rows) == 14
        assert [row["id"] for row in rows].count(fa["id"]) == 1
    finally:
        # The pre-fix seed inserts a duplicate while the prefix is renamed. A RED
        # observation must not leave the shared session database with an extra
        # type, so the squatter is removed before the prefix is restored.
        squatters = db.exec(
            select(DocumentType).where(
                DocumentType.prefix == "FA", DocumentType.id != fa["id"]
            )
        ).all()
        for squatter in squatters:
            db.delete(squatter)
        db.commit()
        client.patch(
            f"{settings.API_V1_STR}/document-types/{fa['id']}",
            headers=superuser_token_headers,
            json={"prefix": "FA", "name": "Factura A"},
        )


def test_reseed_adopts_the_row_in_service_over_a_duplicate(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """A duplicate left by the old prefix-keyed seed must not take the identity.

    The old seed matched rows by `prefix`, so renaming a prefix made the next startup insert a
    duplicate of the type. When both rows exist, the one a document or a numbering sequence
    points at is the original, and the key belongs to it: stamping the key onto the duplicate
    would split one logical type across two rows, with its documents and its numbering on
    different sides.
    """
    fa = _type_by_prefix(client, superuser_token_headers, "FA")
    fa_id = uuid.UUID(fa["id"])
    # A numbering sequence is the lightest form of "this type is in service".
    created_sequence = False
    if (
        db.exec(
            select(DocumentSequence).where(
                DocumentSequence.document_type_id == fa_id,
                DocumentSequence.year == 2026,
            )
        ).first()
        is None
    ):
        db.add(DocumentSequence(document_type_id=fa_id, year=2026, last_number=3))
        db.commit()
        created_sequence = True
    duplicate = DocumentType(
        key=None,
        name="Factura A",
        prefix="FA",
        operation=DocumentOperation.VENTA,
        signo_stock=-1,
        signo_caja=1,
        es_fiscal=True,
        tipo_contraparte=CounterpartType.CUSTOMER,
    )
    original = db.get(DocumentType, fa_id)
    assert original is not None
    try:
        # The shape a database predating `key` has once a renamed type was duplicated.
        original.prefix = "FAX"
        original.key = None
        db.add(original)
        db.add(duplicate)
        db.commit()

        init_db(db)

        db.refresh(original)
        db.refresh(duplicate)
        assert original.key == "factura_a"
        assert duplicate.key is None
    finally:
        db.rollback()
        # Drop everything this test created, so a RED observation cannot leave the shared
        # database dirty: the sequence that marks the original as in service, and any row
        # squatting on the prefix.
        if created_sequence:
            for sequence in db.exec(
                select(DocumentSequence).where(
                    DocumentSequence.document_type_id == fa_id
                )
            ).all():
                db.delete(sequence)
        for squatter in db.exec(
            select(DocumentType).where(
                DocumentType.prefix == "FA", DocumentType.id != fa_id
            )
        ).all():
            db.delete(squatter)
        db.flush()
        restored = db.get(DocumentType, fa_id)
        if restored is not None:
            restored.prefix = "FA"
            restored.key = "factura_a"
            db.add(restored)
        db.commit()


def test_key_cannot_be_edited_via_patch(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The stable identity is seed-managed: the API rejects an attempt to change it."""
    fa = _type_by_prefix(client, superuser_token_headers, "FA")
    original_key = fa["key"]
    assert original_key

    r = client.patch(
        f"{settings.API_V1_STR}/document-types/{fa['id']}",
        headers=superuser_token_headers,
        json={"key": "not_the_seeded_key"},
    )
    assert r.status_code == 400
    assert _type_by_prefix(client, superuser_token_headers, "FA")["key"] == original_key
