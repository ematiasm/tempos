"""Tests for the /taxes endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string


def test_read_taxes_seeded(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """init_db seeds the IVA taxes; the list endpoint must return them."""
    r = client.get(f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 5
    codes = {row["code"] for row in body["data"]}
    assert {"IVA21", "IVA105", "IVA27", "IVA0", "EXENTO"}.issubset(codes)
    # IVA 21% is the seeded default tax
    iva21 = next(row for row in body["data"] if row["code"] == "IVA21")
    assert iva21["is_default"] is True
    others = [row for row in body["data"] if row["code"] != "IVA21"]
    assert all(row["is_default"] is False for row in others)


def test_create_tax(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payload = {
        "name": random_lower_string(),
        "code": random_lower_string()[:8].upper(),
        "tipo": "IVA",
        "rate": "15.00",
        "is_percent": True,
        "aplica_a": "linea",
        "is_active": True,
    }
    r = client.post(
        f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers, json=payload
    )
    assert r.status_code == 200
    created = r.json()
    assert created["name"] == payload["name"]
    assert created["code"] == payload["code"]
    assert created["tipo"] == "IVA"
    assert created["rate"] == "15.00"


def test_create_tax_duplicate_code_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    code = random_lower_string()[:8].upper()
    payload = {
        "name": "First",
        "code": code,
        "tipo": "IVA",
        "rate": "10.00",
        "is_percent": True,
        "aplica_a": "linea",
        "is_active": True,
    }
    r = client.post(
        f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers, json=payload
    )
    assert r.status_code == 200
    payload["name"] = "Second"
    r = client.post(
        f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers, json=payload
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]


def test_update_tax(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payload = {
        "name": random_lower_string(),
        "code": random_lower_string()[:8].upper(),
        "tipo": "IIBB",
        "rate": "3.00",
        "is_percent": True,
        "aplica_a": "linea",
        "is_active": True,
    }
    r = client.post(
        f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers, json=payload
    )
    tax_id = r.json()["id"]
    r = client.patch(
        f"{settings.API_V1_STR}/taxes/{tax_id}",
        headers=superuser_token_headers,
        json={"rate": "5.00", "name": "Updated"},
    )
    assert r.status_code == 200
    updated = r.json()
    assert updated["rate"] == "5.00"
    assert updated["name"] == "Updated"

    # is_default flag round-trip (there is no GET /taxes/{id}, so re-list)
    assert updated["is_default"] is False
    r = client.patch(
        f"{settings.API_V1_STR}/taxes/{tax_id}",
        headers=superuser_token_headers,
        json={"is_default": True},
    )
    assert r.status_code == 200
    assert r.json()["is_default"] is True


def test_delete_tax(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payload = {
        "name": random_lower_string(),
        "code": random_lower_string()[:8].upper(),
        "tipo": "Otro",
        "rate": "1.00",
        "is_percent": False,
        "aplica_a": "linea",
        "is_active": True,
    }
    r = client.post(
        f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers, json=payload
    )
    tax_id = r.json()["id"]
    r = client.delete(
        f"{settings.API_V1_STR}/taxes/{tax_id}", headers=superuser_token_headers
    )
    assert r.status_code == 200
    assert r.json()["message"] == "Tax deleted successfully"


def _create_tax(client: TestClient, headers: dict[str, str], **overrides) -> dict:
    payload = {
        "name": random_lower_string(),
        "code": random_lower_string()[:8].upper(),
        "tipo": "IVA",
        "rate": "10.50",
        "is_percent": True,
        "aplica_a": "linea",
        "is_active": True,
        **overrides,
    }
    r = client.post(f"{settings.API_V1_STR}/taxes/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _create_sale_referencing_tax(
    client: TestClient, headers: dict[str, str], tax_id: str
) -> str:
    """Create a product taxed with ``tax_id`` and sell it; returns the sale numero."""
    r = client.post(
        f"{settings.API_V1_STR}/uoms/",
        headers=headers,
        json={
            "name": random_lower_string()[:10],
            "abbreviation": random_lower_string()[:3].upper(),
            "decimal_places": 0,
        },
    )
    uom_id = r.json()["id"]
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=headers,
        json={
            "name": random_lower_string()[:20],
            "uom_id": uom_id,
            "margen_pct": "21.00",
            "costo_actual": "100.00",
            "tax_ids": [tax_id],
        },
    )
    assert r.status_code == 200, r.text
    product_id = r.json()["id"]
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=headers,
        json={"razon_social": random_lower_string()[:20], "condicion_fiscal": "RI"},
    )
    assert r.status_code == 200, r.text
    customer_id = r.json()["id"]
    # Load stock (AJS) so the sale does not go negative.
    r = client.get(
        f"{settings.API_V1_STR}/document-types/", headers=headers, params={"limit": 100}
    )
    ajs = next(row for row in r.json()["data"] if row["prefix"] == "AJS")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=headers,
        json={
            "document_type_id": ajs["id"],
            "lines": [{"product_id": product_id, "cantidad": "3"}],
        },
    )
    assert r.status_code == 200, r.text
    r = client.get(
        f"{settings.API_V1_STR}/document-types/", headers=headers, params={"limit": 100}
    )
    tck = next(row for row in r.json()["data"] if row["prefix"] == "TCK")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=headers,
        json={
            "document_type_id": tck["id"],
            "contraparte_id": customer_id,
            "lines": [{"product_id": product_id, "cantidad": "1"}],
            "payments": [],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["numero"]


def test_delete_tax_used_in_document_is_blocked(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    tax = _create_tax(client, superuser_token_headers)
    sale_numero = _create_sale_referencing_tax(
        client, superuser_token_headers, tax["id"]
    )
    r = client.delete(
        f"{settings.API_V1_STR}/taxes/{tax['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "tax_in_use"
    assert any(d["numero"] == sale_numero for d in detail["documents"])
    # The tax is still there.
    r = client.get(f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers)
    assert any(row["id"] == tax["id"] for row in r.json()["data"])


def test_update_tax_restricted_fields_blocked_when_in_use(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    tax = _create_tax(client, superuser_token_headers)
    _create_sale_referencing_tax(client, superuser_token_headers, tax["id"])

    # Fiscal fields are frozen once the tax is in documents.
    r = client.patch(
        f"{settings.API_V1_STR}/taxes/{tax['id']}",
        headers=superuser_token_headers,
        json={"rate": "21.00"},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "tax_in_use"
    r = client.patch(
        f"{settings.API_V1_STR}/taxes/{tax['id']}",
        headers=superuser_token_headers,
        json={"tipo": "Otro"},
    )
    assert r.status_code == 409

    # name, code, is_default and is_active stay editable.
    for payload in (
        {"name": "Renamed"},
        {"code": random_lower_string()[:8].upper()},
        {"is_default": True},
        {"is_active": False},
    ):
        r = client.patch(
            f"{settings.API_V1_STR}/taxes/{tax['id']}",
            headers=superuser_token_headers,
            json=payload,
        )
        assert r.status_code == 200, (payload, r.text)


def test_multiple_default_taxes_allowed(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    tax1 = _create_tax(client, superuser_token_headers, is_default=True)
    tax2 = _create_tax(client, superuser_token_headers, is_default=True)
    r = client.get(f"{settings.API_V1_STR}/taxes/", headers=superuser_token_headers)
    rows = {row["id"]: row for row in r.json()["data"]}
    assert rows[tax1["id"]]["is_default"] is True
    assert rows[tax2["id"]]["is_default"] is True
    # A default tax is deletable like any other.
    r = client.delete(
        f"{settings.API_V1_STR}/taxes/{tax1['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
