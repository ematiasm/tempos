"""Tests for the /business-settings endpoints (singleton)."""

import io

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
    assert body["number_format"] in ("es", "en")
    assert body["stock_policy"] in ("block", "warn")
    assert body["default_locale"] in ("es", "en")


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


def test_update_new_configuration_fields(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payment_methods = client.get(
        f"{settings.API_V1_STR}/payment-methods/", headers=superuser_token_headers
    ).json()["data"]
    assert payment_methods
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "number_format": "es",
            "stock_policy": "block",
            "default_locale": "es",
            "payment_method_default_id": payment_methods[0]["id"],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["number_format"] == "es"
    assert body["stock_policy"] == "block"
    assert body["default_locale"] == "es"
    assert body["payment_method_default_id"] == payment_methods[0]["id"]

    # restore defaults
    r = client.patch(
        f"{settings.API_V1_STR}/business-settings/",
        headers=superuser_token_headers,
        json={
            "number_format": "en",
            "stock_policy": "warn",
            "default_locale": "en",
            "payment_method_default_id": None,
        },
    )
    assert r.status_code == 200, r.text


def test_upload_and_delete_logo(
    client: TestClient, superuser_token_headers: dict[str, str], tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    r = client.post(
        f"{settings.API_V1_STR}/business-settings/logo",
        headers=superuser_token_headers,
        files={"file": ("logo.png", io.BytesIO(b"\x89PNG fake"), "image/png")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["logo_path"] == "/uploads/logo.png"
    assert (tmp_path / "logo.png").is_file()

    r = client.delete(
        f"{settings.API_V1_STR}/business-settings/logo",
        headers=superuser_token_headers,
    )
    assert r.status_code == 204
    assert not (tmp_path / "logo.png").exists()
    body = client.get(
        f"{settings.API_V1_STR}/business-settings/", headers=superuser_token_headers
    ).json()
    assert body["logo_path"] is None


def test_upload_logo_rejects_bad_format(
    client: TestClient, superuser_token_headers: dict[str, str], tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    r = client.post(
        f"{settings.API_V1_STR}/business-settings/logo",
        headers=superuser_token_headers,
        files={"file": ("malware.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
    )
    assert r.status_code == 400
    assert not any(tmp_path.iterdir())
