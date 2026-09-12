"""Tests for the /document-types endpoints."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import init_db
from app.models import DocumentType


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
        # A RED observation runs against the pre-fix seed, which inserts a duplicate
        # while the prefix is renamed. It must not leave the shared session database
        # with an extra type, so the squatter is removed before the prefix is restored.
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
