"""Tests for the /business-settings endpoints (singleton)."""

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string


def test_read_business_settings_singleton(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == 1
    assert body["allow_negative_stock"] is False
    assert body["enable_variants"] is False


def test_update_business_settings(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    new_name = random_lower_string()[:15]
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "business_name": new_name,
            "condicion_fiscal": "RI",
            "allow_negative_stock": True,
            "cuit": "30-12345678-9",
        },
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["business_name"] == new_name
    assert updated["condicion_fiscal"] == "RI"
    assert updated["allow_negative_stock"] is True
    assert updated["cuit"] == "30-12345678-9"

    # restore safe defaults so other tests keep their assumptions
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={"allow_negative_stock": False, "condicion_fiscal": "Consumidor Final"},
    )
    assert r.status_code == 200
