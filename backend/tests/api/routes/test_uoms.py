"""Tests for the /uoms endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string


def _create_uom(
    client: TestClient, headers: dict[str, str], name: str | None = None
) -> dict:
    payload = {
        "name": name or random_lower_string()[:10],
        "abbreviation": random_lower_string()[:3].upper(),
        "decimal_places": 0,
    }
    r = client.post(f"{settings.API_V1_STR}/uoms/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_uom(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    assert uom["name"]
    assert uom["abbreviation"]
    assert uom["decimal_places"] == 0


def test_read_uoms_paged(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    _create_uom(client, superuser_token_headers)
    r = client.get(
        f"{settings.API_V1_STR}/uoms/",
        headers=superuser_token_headers,
        params={"skip": 0, "limit": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    assert len(body["data"]) <= 5


def test_update_uom(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    r = client.patch(
        f"{settings.API_V1_STR}/uoms/{uom['id']}",
        headers=superuser_token_headers,
        json={"decimal_places": 3, "name": "Kilogram 2"},
    )
    assert r.status_code == 200
    updated = r.json()
    assert updated["decimal_places"] == 3
    assert updated["name"] == "Kilogram 2"


def test_delete_uom(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    uom = _create_uom(client, superuser_token_headers)
    r = client.delete(
        f"{settings.API_V1_STR}/uoms/{uom['id']}", headers=superuser_token_headers
    )
    assert r.status_code == 200
    assert r.json()["message"] == "Unit of measure deleted successfully"
