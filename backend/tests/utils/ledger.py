"""Helpers for ledger-aware document tests."""

from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.core.config import settings
from app.models import StockMovement


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


def pin_created_at(session: Session, movement: StockMovement, when: datetime) -> None:
    """Place a ledger row on a specific timestamp.

    ``created_at`` is server-generated, so a test that needs a movement in another
    business day has to write it. The ledger is append-only and the guard trigger
    rejects that write, so this uses the same test-only escape hatch as
    ``conftest._clean_test_data``: user triggers disabled for one transaction.
    """
    session.execute(text("SET LOCAL session_replication_role = replica"))
    movement.created_at = when
    session.add(movement)
    session.commit()
