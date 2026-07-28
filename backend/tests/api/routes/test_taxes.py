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
