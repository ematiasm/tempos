"""Tests for the /categories endpoints."""

import uuid

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string


def _create_category(
    client: TestClient, headers: dict[str, str], name: str | None = None
) -> dict:
    payload = {"name": name or random_lower_string()[:20]}
    r = client.post(f"{settings.API_V1_STR}/categories/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_category(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cat = _create_category(client, superuser_token_headers)
    assert cat["name"]
    assert cat["parent_id"] is None


def test_create_category_with_invalid_parent_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    payload = {"name": "child", "parent_id": str(uuid.uuid4())}
    r = client.post(
        f"{settings.API_V1_STR}/categories/",
        headers=superuser_token_headers,
        json=payload,
    )
    assert r.status_code == 400
    assert "Parent category not found" in r.json()["detail"]


def test_category_cannot_be_own_parent(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    parent = _create_category(client, superuser_token_headers)
    r = client.patch(
        f"{settings.API_V1_STR}/categories/{parent['id']}",
        headers=superuser_token_headers,
        json={"parent_id": parent["id"]},
    )
    assert r.status_code == 400
    assert "cannot be its own parent" in r.json()["detail"]


def test_category_tree(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    parent = _create_category(client, superuser_token_headers, "parent-tree")
    child_payload = {"name": "child-tree", "parent_id": parent["id"]}
    r = client.post(
        f"{settings.API_V1_STR}/categories/",
        headers=superuser_token_headers,
        json=child_payload,
    )
    assert r.status_code == 200
    child = r.json()
    assert child["parent_id"] == parent["id"]


def test_update_category(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cat = _create_category(client, superuser_token_headers)
    r = client.patch(
        f"{settings.API_V1_STR}/categories/{cat['id']}",
        headers=superuser_token_headers,
        json={"name": "renamed"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "renamed"


def test_delete_category(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    cat = _create_category(client, superuser_token_headers)
    r = client.delete(
        f"{settings.API_V1_STR}/categories/{cat['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    r = client.get(
        f"{settings.API_V1_STR}/categories/{cat['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404
