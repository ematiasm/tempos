"""Tests for the /customers endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string, random_valid_cuit


def _create_customer(client: TestClient, headers: dict[str, str], **overrides) -> dict:
    payload = {
        "razon_social": random_lower_string()[:20],
        "condicion_fiscal": "RI",
        **overrides,
    }
    r = client.post(f"{settings.API_V1_STR}/customers/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_consumidor_final_is_seeded_and_protected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/customers/",
        headers=superuser_token_headers,
        params={"limit": 1000},
    )
    assert r.status_code == 200
    cf = next(
        (c for c in r.json()["data"] if c["razon_social"] == "Consumidor Final"), None
    )
    assert cf is not None
    assert cf["documento"] is None
    assert cf["condicion_fiscal"] == "Consumidor Final"
    assert cf["limite_credito"] == "0.00"
    assert cf["saldo"] == "0.00"

    # protected from delete
    r = client.delete(
        f"{settings.API_V1_STR}/customers/{cf['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 400
    assert "cannot be deleted" in r.json()["detail"]

    # protected from deactivation
    r = client.patch(
        f"{settings.API_V1_STR}/customers/{cf['id']}",
        headers=superuser_token_headers,
        json={"is_active": False},
    )
    assert r.status_code == 400
    assert "cannot be deactivated" in r.json()["detail"]


def test_create_and_read_customer(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cuit = random_valid_cuit()
    created = _create_customer(
        client,
        superuser_token_headers,
        documento=cuit,
        phone="11-5555-5555",
        limite_credito="5000.00",
    )
    assert created["documento"] == cuit
    assert created["limite_credito"] == "5000.00"
    assert created["saldo"] == "0.00"
    assert created["is_active"] is True

    r = client.get(
        f"{settings.API_V1_STR}/customers/{created['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_documento_is_normalized_and_unique(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cuit = random_valid_cuit()
    _create_customer(client, superuser_token_headers, documento=cuit)

    # same CUIT formatted with hyphens must collide after normalization
    formatted = f"{cuit[:2]}-{cuit[2:10]}-{cuit[10]}"
    payload = {
        "razon_social": random_lower_string()[:20],
        "documento": formatted,
        "condicion_fiscal": "RI",
    }
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]


def test_documento_validation_rejects_dni_and_bad_cuit(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # DNI (8 digits) is rejected: only CUIT/CUIL accepted
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=superuser_token_headers,
        json={"razon_social": "Some Person", "documento": "12345678"},
    )
    assert r.status_code == 422
    assert "11-digit CUIT" in str(r.json())

    # 11 digits with a corrupted check digit
    valid = random_valid_cuit()
    bad = valid[:-1] + ("1" if valid[-1] == "0" else "0")
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=superuser_token_headers,
        json={"razon_social": "Bad CUIT", "documento": bad},
    )
    assert r.status_code == 422
    assert "check digit" in str(r.json())


def test_documento_null_allowed_multiple_times(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    for _ in range(2):
        created = _create_customer(client, superuser_token_headers)
        assert created["documento"] is None


def test_update_customer(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    new_cuit = random_valid_cuit()
    r = client.patch(
        f"{settings.API_V1_STR}/customers/{customer['id']}",
        headers=superuser_token_headers,
        json={"razon_social": "Updated Name", "documento": new_cuit},
    )
    assert r.status_code == 200
    assert r.json()["razon_social"] == "Updated Name"
    assert r.json()["documento"] == new_cuit

    # clearing the document with an empty string sets it to null
    r = client.patch(
        f"{settings.API_V1_STR}/customers/{customer['id']}",
        headers=superuser_token_headers,
        json={"documento": ""},
    )
    assert r.status_code == 200
    assert r.json()["documento"] is None


def test_update_customer_duplicate_documento_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    first = _create_customer(
        client, superuser_token_headers, documento=random_valid_cuit()
    )
    second = _create_customer(client, superuser_token_headers)
    r = client.patch(
        f"{settings.API_V1_STR}/customers/{second['id']}",
        headers=superuser_token_headers,
        json={"documento": first["documento"]},
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]


def test_delete_customer_soft_deactivates(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    customer = _create_customer(client, superuser_token_headers)
    r = client.delete(
        f"{settings.API_V1_STR}/customers/{customer['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    r = client.get(
        f"{settings.API_V1_STR}/customers/{customer['id']}",
        headers=superuser_token_headers,
    )
    assert r.json()["is_active"] is False
