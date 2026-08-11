"""Helpers for ledger-aware document tests."""

from fastapi.testclient import TestClient

from app.core.config import settings


def load_stock(
    client: TestClient,
    headers: dict[str, str],
    product_id: str,
    cantidad: str,
) -> None:
    """Add stock to a product via an Ajuste Stock document."""
    r = client.get(
        f"{settings.API_V1_STR}/document-types/",
        headers=headers,
        params={"limit": 100},
    )
    assert r.status_code == 200
    ajs = next(row for row in r.json()["data"] if row["prefix"] == "AJS")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=headers,
        json={
            "document_type_id": ajs["id"],
            "lines": [{"product_id": product_id, "cantidad": cantidad}],
        },
    )
    assert r.status_code == 200, r.text


def unload_stock(
    client: TestClient,
    headers: dict[str, str],
    product_id: str,
    cantidad: str,
) -> None:
    """Remove stock from a product via a negative Ajuste Stock document."""
    load_stock(client, headers, product_id, f"-{cantidad}")
