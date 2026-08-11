"""Tests for the /suppliers endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string, random_valid_cuit


def _create_supplier(client: TestClient, headers: dict[str, str], **overrides) -> dict:
    payload = {
        "razon_social": random_lower_string()[:20],
        "condicion_fiscal": "RI",
        **overrides,
    }
    r = client.post(f"{settings.API_V1_STR}/suppliers/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_and_read_supplier(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cuit = random_valid_cuit()
    created = _create_supplier(
        client,
        superuser_token_headers,
        documento=cuit,
        email="supplier@example.com",
    )
    assert created["documento"] == cuit
    assert created["saldo"] == "0.00"
    assert "limite_credito" not in created

    r = client.get(
        f"{settings.API_V1_STR}/suppliers/{created['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_documento_normalized_unique_and_validated(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cuit = random_valid_cuit()
    _create_supplier(client, superuser_token_headers, documento=cuit)

    # same CUIT formatted with hyphens collides after normalization
    formatted = f"{cuit[:2]}-{cuit[2:10]}-{cuit[10]}"
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/",
        headers=superuser_token_headers,
        json={"razon_social": "Other", "documento": formatted},
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]

    # DNI rejected
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/",
        headers=superuser_token_headers,
        json={"razon_social": "DNI supplier", "documento": "30123456"},
    )
    assert r.status_code == 422


def test_update_supplier(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    r = client.patch(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}",
        headers=superuser_token_headers,
        json={"phone": "11-4444-4444"},
    )
    assert r.status_code == 200
    assert r.json()["phone"] == "11-4444-4444"


def test_delete_supplier_hard_deletes_when_unused(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    r = client.delete(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["message"] == "Supplier deleted successfully"
    r = client.get(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404


def test_delete_supplier_used_in_document_is_blocked(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    supplier = _create_supplier(client, superuser_token_headers)
    # Create an OC (purchase order) referencing the supplier.
    r = client.post(
        f"{settings.API_V1_STR}/uoms/",
        headers=superuser_token_headers,
        json={
            "name": random_lower_string()[:10],
            "abbreviation": random_lower_string()[:3].upper(),
            "decimal_places": 0,
        },
    )
    uom_id = r.json()["id"]
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json={
            "name": random_lower_string()[:20],
            "uom_id": uom_id,
            "margen_pct": "21.00",
            "costo_actual": "100.00",
            "tax_ids": [],
        },
    )
    assert r.status_code == 200, r.text
    product_id = r.json()["id"]
    r = client.get(
        f"{settings.API_V1_STR}/document-types/",
        headers=superuser_token_headers,
        params={"limit": 100},
    )
    oc = next(row for row in r.json()["data"] if row["prefix"] == "OC")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": oc["id"],
            "contraparte_id": supplier["id"],
            "lines": [{"product_id": product_id, "cantidad": "1"}],
            "payments": [],
        },
    )
    assert r.status_code == 200, r.text
    oc_numero = r.json()["numero"]
    r = client.delete(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "supplier_in_use"
    assert any(d["numero"] == oc_numero for d in detail["documents"])
    # The supplier is still there.
    r = client.get(
        f"{settings.API_V1_STR}/suppliers/{supplier['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
