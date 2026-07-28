"""Tests for the /roles endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string


def _get_permission_id(client: TestClient, headers: dict[str, str], code: str) -> str:
    r = client.get(
        f"{settings.API_V1_STR}/permissions/",
        headers=headers,
        params={"limit": 1000},
    )
    assert r.status_code == 200
    for permission in r.json()["data"]:
        if permission["code"] == code:
            return permission["id"]
    raise AssertionError(f"Permission {code} not found")


def test_list_roles_contains_administrador(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/roles/", headers=superuser_token_headers)
    assert r.status_code == 200
    names = {row["name"] for row in r.json()["data"]}
    assert "Administrador" in names
    admin = next(row for row in r.json()["data"] if row["name"] == "Administrador")
    assert len(admin["permissions"]) > 0


def test_create_update_and_delete_role(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    perm_id = _get_permission_id(client, superuser_token_headers, "product.read")
    payload = {
        "name": random_lower_string()[:12],
        "description": "Test role",
        "permission_ids": [perm_id],
    }
    r = client.post(
        f"{settings.API_V1_STR}/roles/", headers=superuser_token_headers, json=payload
    )
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["name"] == payload["name"]
    assert [p["code"] for p in created["permissions"]] == ["product.read"]

    # update: replace permissions with an empty set
    r = client.patch(
        f"{settings.API_V1_STR}/roles/{created['id']}",
        headers=superuser_token_headers,
        json={"description": "Updated", "permission_ids": []},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["description"] == "Updated"
    assert updated["permissions"] == []

    # duplicate name rejected
    r = client.post(
        f"{settings.API_V1_STR}/roles/", headers=superuser_token_headers, json=payload
    )
    assert r.status_code == 400
    assert "already exists" in r.json()["detail"]

    # delete
    r = client.delete(
        f"{settings.API_V1_STR}/roles/{created['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200


def test_administrador_role_cannot_be_deleted(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/roles/", headers=superuser_token_headers)
    admin = next(row for row in r.json()["data"] if row["name"] == "Administrador")
    r = client.delete(
        f"{settings.API_V1_STR}/roles/{admin['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 400
    assert "cannot be deleted" in r.json()["detail"]
