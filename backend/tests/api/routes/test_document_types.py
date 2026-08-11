"""Tests for the /document-types endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings


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
