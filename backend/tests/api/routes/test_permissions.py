"""Tests for the /permissions endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings


def test_list_permissions_seeded(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/permissions/",
        headers=superuser_token_headers,
        params={"limit": 1000},
    )
    assert r.status_code == 200
    codes = {row["code"] for row in r.json()["data"]}
    expected = {
        "user.read",
        "role.create",
        "permission.read",
        "settings.update",
        "product.read",
        "category.delete",
        "document.void",
        "stock.adjust",
        "report.view",
    }
    assert expected.issubset(codes)
    # every code follows the resource.action convention
    for code in codes:
        assert "." in code and not code.startswith(".") and not code.endswith(".")
