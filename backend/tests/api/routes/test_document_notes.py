"""Tests for document notes (create payload, read payloads, PATCH endpoint)."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import PaymentMethod
from tests.utils.ledger import load_stock
from tests.utils.utils import random_lower_string


def _create_uom(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/uoms/",
        headers=headers,
        json={
            "name": random_lower_string()[:10],
            "abbreviation": random_lower_string()[:3].upper(),
            "decimal_places": 0,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_product(client: TestClient, headers: dict[str, str]) -> dict:
    uom = _create_uom(client, headers)
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=headers,
        json={
            "name": random_lower_string()[:20],
            "uom_id": uom["id"],
            "margen_pct": "21.00",
            "costo_actual": "100.00",
            "tax_ids": [],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_customer(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/customers/",
        headers=headers,
        json={
            "razon_social": random_lower_string()[:20],
            "condicion_fiscal": "RI",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_supplier(client: TestClient, headers: dict[str, str]) -> dict:
    r = client.post(
        f"{settings.API_V1_STR}/suppliers/",
        headers=headers,
        json={"razon_social": random_lower_string()[:20], "condicion_fiscal": "RI"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _doc_type_id(client: TestClient, headers: dict[str, str], prefix: str) -> str:
    r = client.get(
        f"{settings.API_V1_STR}/document-types/",
        headers=headers,
        params={"limit": 100},
    )
    assert r.status_code == 200
    return next(row for row in r.json()["data"] if row["prefix"] == prefix)["id"]


def _create_doc(client: TestClient, headers: dict[str, str], payload: dict) -> dict:
    r = client.post(f"{settings.API_V1_STR}/documents/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _note_of(length: int) -> str:
    return ("n" * length)[:length]


def test_document_notes_round_trip_on_all_types(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """Notes ride the create payload and come back on reads, on every type."""
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    supplier = _create_supplier(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "2")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    cot = _doc_type_id(client, superuser_token_headers, "COT")
    oc = _doc_type_id(client, superuser_token_headers, "OC")
    note = _note_of(500)

    sale = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "notes": note,
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    quote = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": cot,
            "contraparte_id": customer["id"],
            "notes": "Quote note",
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    purchase = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": oc,
            "contraparte_id": supplier["id"],
            "notes": "Purchase note",
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )

    for doc, expected in (
        (sale, note),
        (quote, "Quote note"),
        (purchase, "Purchase note"),
    ):
        assert doc["notes"] == expected
        r = client.get(
            f"{settings.API_V1_STR}/documents/{doc['id']}",
            headers=superuser_token_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["notes"] == expected
        r = client.get(
            f"{settings.API_V1_STR}/documents/",
            headers=superuser_token_headers,
            params={"document_type_id": doc["document_type_id"], "limit": 100},
        )
        assert r.status_code == 200, r.text
        listed = next(d for d in r.json()["data"] if d["id"] == doc["id"])
        assert listed["notes"] == expected


def test_document_notes_over_limit_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    r = client.post(
        f"{settings.API_V1_STR}/documents/",
        headers=superuser_token_headers,
        json={
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "notes": _note_of(501),
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    assert r.status_code == 422


def test_update_document_notes_sets_and_clears(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    assert doc["notes"] is None

    # set
    r = client.patch(
        f"{settings.API_V1_STR}/documents/{doc['id']}/notes",
        headers=superuser_token_headers,
        json={"notes": "Deliver before 6 pm"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["notes"] == "Deliver before 6 pm"

    # replace
    r = client.patch(
        f"{settings.API_V1_STR}/documents/{doc['id']}/notes",
        headers=superuser_token_headers,
        json={"notes": "Updated note"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["notes"] == "Updated note"

    # clear
    r = client.patch(
        f"{settings.API_V1_STR}/documents/{doc['id']}/notes",
        headers=superuser_token_headers,
        json={"notes": None},
    )
    assert r.status_code == 200, r.text
    assert r.json()["notes"] is None


def test_update_document_notes_over_limit_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/documents/{uuid.uuid4()}/notes",
        headers=superuser_token_headers,
        json={"notes": _note_of(501)},
    )
    assert r.status_code == 422


def test_update_document_notes_unknown_document_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{settings.API_V1_STR}/documents/{uuid.uuid4()}/notes",
        headers=superuser_token_headers,
        json={"notes": "orphan"},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "document_not_found"


def test_update_document_notes_voided_document_rejected(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    product = _create_product(client, superuser_token_headers)
    customer = _create_customer(client, superuser_token_headers)
    load_stock(client, superuser_token_headers, product["id"], "1")
    tck = _doc_type_id(client, superuser_token_headers, "TCK")
    doc = _create_doc(
        client,
        superuser_token_headers,
        {
            "document_type_id": tck,
            "contraparte_id": customer["id"],
            "lines": [{"product_id": product["id"], "cantidad": "1"}],
        },
    )
    r = client.post(
        f"{settings.API_V1_STR}/documents/{doc['id']}/void",
        headers=superuser_token_headers,
        json={"lines": []},
    )
    assert r.status_code == 200, r.text

    r = client.patch(
        f"{settings.API_V1_STR}/documents/{doc['id']}/notes",
        headers=superuser_token_headers,
        json={"notes": "should not apply"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "document_not_editable"
